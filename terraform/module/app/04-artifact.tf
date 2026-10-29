## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/artifact_registry_repository ##
## Name must match _REPO in cloudbuild.deploy.yaml ##
resource "google_artifact_registry_repository" "artifact_registry_repository" {
  project       = var.project_id
  location      = var.region
  repository_id = var.project_name
  description   = "rafael-server images"
  format        = "DOCKER"

  depends_on = [google_project_service.project_service]
}
