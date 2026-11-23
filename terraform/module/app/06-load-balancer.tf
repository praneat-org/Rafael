## Custom domain over HTTPS for the web version (CAR-3845): global external Application Load Balancer -> serverless NEG -> Cloud Run ##
## Replaces Cloud Run domain mapping (Preview, not for production). Empty custom_domain = no load balancer ##
## No Search Console verification needed: point an A record at the output custom_domain_ip, Google issues the cert once it resolves ##
## Cloud Run itself is owned by cloudbuild.deploy.yaml; the NEG only references the service name ##
## WebSocket works through the LB; for serverless NEG backends the Cloud Run request timeout (60 min) applies, not timeoutSec ##
## Session affinity: Cloud Run's own affinity cookie passes through the LB unchanged ##
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

  backend {
    group = google_compute_region_network_endpoint_group.web[each.key].id
  }

  # request logs carry URL paths only (/ws, /api/*, static files): no content (D11)
  log_config {
    enable      = true
    sample_rate = 1
  }

  depends_on = [google_project_service.project_service]
}

## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_managed_ssl_certificate ##
resource "google_compute_managed_ssl_certificate" "web" {
  for_each = local.lb

  project = var.project_id
  name    = "${var.cloud_run_service_name}-cert"

  managed {
    domains = [var.custom_domain]
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
  ssl_certificates = [google_compute_managed_ssl_certificate.web[each.key].id]
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
