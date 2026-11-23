## Custom domain over HTTPS for the web version (CAR-3845): Cloudflare (proxied) -> global external Application Load Balancer ##
## -> serverless NEG -> Cloud Run. Same pattern as ValorVantageOCR infra. Empty custom_domain = none of this ##
## TLS: browser <-> Cloudflare = Cloudflare edge cert; Cloudflare <-> LB = Cloudflare Origin Certificate (*.praneat.com, pem files) ##
## Zone SSL mode must be Full (strict). Cloud Armor allows only Cloudflare IPs, so the LB IP cannot be hit directly ##
## WebSocket: Cloudflare proxies it (idle timeout 100 s, the server pings every 25 s); Cloud Run 60 min request timeout applies ##
## Session affinity: Cloud Run's own affinity cookie passes through Cloudflare and the LB unchanged ##
## ponytail: Cloud Run ingress stays "all" (the extension still talks to the run.app URL). Lock to ##
## internal-and-cloud-load-balancing once every client uses the custom domain ##

locals {
  lb = var.custom_domain == "" ? toset([]) : toset(["web"])
}

## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_global_address ##
resource "google_compute_global_address" "web" {
  for_each = local.lb

  project = var.project_id
  name    = "${var.cloud_run_service_name}-ip"

  depends_on = [google_project_service.project_service]
}

## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_region_network_endpoint_group ##
resource "google_compute_region_network_endpoint_group" "web" {
  for_each = local.lb

  project               = var.project_id
  region                = var.region
  name                  = "${var.cloud_run_service_name}-neg"
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = var.cloud_run_service_name
  }

  depends_on = [google_project_service.project_service]
}

## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_backend_service ##
resource "google_compute_backend_service" "web" {
  for_each = local.lb

  project               = var.project_id
  name                  = "${var.cloud_run_service_name}-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"
  security_policy       = google_compute_security_policy.cloudflare_only[each.key].id

  backend {
    group = google_compute_region_network_endpoint_group.web[each.key].id
  }

  # request logs record the request URL, including any query string. Never put a token or content in a URL (D11)
  log_config {
    enable      = true
    sample_rate = 1
  }

  depends_on = [google_project_service.project_service]
}

## Cloudflare Origin Certificate: trusted only by Cloudflare, so the record must stay proxied ##
## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_ssl_certificate ##
resource "google_compute_ssl_certificate" "web" {
  for_each = local.lb

  # ponytail: fixed name. Changing the pem files (cert valid to 2039) clashes with create_before_destroy:
  # bump the name suffix (e.g. -origin-cert-2) in the same change
  project     = var.project_id
  name        = "${var.cloud_run_service_name}-origin-cert"
  certificate = file(var.pem_certificate)
  private_key = file(var.pem_private_key)

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [google_project_service.project_service]
}

## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_url_map ##
resource "google_compute_url_map" "web" {
  for_each = local.lb

  project         = var.project_id
  name            = "${var.cloud_run_service_name}-https"
  default_service = google_compute_backend_service.web[each.key].id
}

resource "google_compute_target_https_proxy" "web" {
  for_each = local.lb

  project          = var.project_id
  name             = "${var.cloud_run_service_name}-https"
  url_map          = google_compute_url_map.web[each.key].id
  ssl_certificates = [google_compute_ssl_certificate.web[each.key].id]
}

resource "google_compute_global_forwarding_rule" "web_https" {
  for_each = local.lb

  project               = var.project_id
  name                  = "${var.cloud_run_service_name}-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.web[each.key].id
  port_range            = "443"
  target                = google_compute_target_https_proxy.web[each.key].id
}

## http -> https redirect on the same IP ##
resource "google_compute_url_map" "web_redirect" {
  for_each = local.lb

  project = var.project_id
  name    = "${var.cloud_run_service_name}-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }

  depends_on = [google_project_service.project_service]
}

resource "google_compute_target_http_proxy" "web_redirect" {
  for_each = local.lb

  project = var.project_id
  name    = "${var.cloud_run_service_name}-http-redirect"
  url_map = google_compute_url_map.web_redirect[each.key].id
}

resource "google_compute_global_forwarding_rule" "web_http" {
  for_each = local.lb

  project               = var.project_id
  name                  = "${var.cloud_run_service_name}-http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.web[each.key].id
  port_range            = "80"
  target                = google_compute_target_http_proxy.web_redirect[each.key].id
}

## https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/dns_record ##
resource "cloudflare_dns_record" "web" {
  for_each = local.lb

  zone_id = var.cloudflare_zone_id
  name    = var.custom_domain
  content = google_compute_global_address.web[each.key].address
  type    = "A"
  proxied = true
  ttl     = 1
}

## ---------------- Cloud Armor: only Cloudflare edge IPs reach the LB ---------------- ##
## https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/data-sources/ip_ranges ##
data "cloudflare_ip_ranges" "cloudflare" {
  for_each = local.lb
}

locals {
  # Cloud Armor basic match allows max 10 src_ip_ranges per rule
  cloudflare_cidr_chunks = chunklist(
    flatten([for r in data.cloudflare_ip_ranges.cloudflare : concat(r.ipv4_cidrs, r.ipv6_cidrs)]),
    10
  )
}

## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_security_policy ##
resource "google_compute_security_policy" "cloudflare_only" {
  for_each = local.lb

  project     = var.project_id
  name        = "${var.cloud_run_service_name}-cloudflare-only"
  description = "Allow only Cloudflare IP ranges"

  dynamic "rule" {
    for_each = local.cloudflare_cidr_chunks
    content {
      action      = "allow"
      priority    = 1000 + rule.key
      description = "Allow Cloudflare IPs (${rule.key + 1}/${length(local.cloudflare_cidr_chunks)})"
      match {
        versioned_expr = "SRC_IPS_V1"
        config {
          src_ip_ranges = rule.value
        }
      }
    }
  }

  rule {
    action      = "deny(403)"
    priority    = 2147483647
    description = "Default deny"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }

  depends_on = [google_project_service.project_service]
}
