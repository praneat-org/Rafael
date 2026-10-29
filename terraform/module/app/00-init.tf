## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/google_project_service ##
resource "google_project_service" "project_service" {
  for_each = toset(var.gcloud_service)

  project                    = var.project_id
  service                    = each.value
  disable_on_destroy         = false
  disable_dependent_services = false
}
