## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/google_project_service ##
resource "google_project_service" "project_service" {
  # the extra APIs belong to resources in this module, so they are enabled whatever the tfvars list says
  for_each = toset(concat(var.gcloud_service, ["billingbudgets.googleapis.com", "monitoring.googleapis.com", "logging.googleapis.com", "run.googleapis.com"]))

  project                    = var.project_id
  service                    = each.value
  disable_on_destroy         = false
  disable_dependent_services = false
}
