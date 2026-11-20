## Custom domain over HTTPS for the web version (CAR-3845). Empty custom_domain = no mapping ##
## Cloud Run itself is owned by cloudbuild.deploy.yaml: the mapping only references the service name, so the first ##
## cloudbuild deploy must have created the service before this is applied (else the mapping errors: service not found) ##
## Google issues the managed certificate once the DNS records below exist ##

## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_run_domain_mapping ##
resource "google_cloud_run_domain_mapping" "web" {
  count = var.custom_domain == "" ? 0 : 1

  project  = var.project_id
  location = var.region
  name     = var.custom_domain

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = var.cloud_run_service_name
  }

  depends_on = [google_project_service.project_service]
}
