## The GitHub host connection needs a browser OAuth + GitHub App install, so it is created once in the console ##
## (Cloud Build > Repositories > 2nd gen > Create host connection, region = var.region, name = var.github_connection_name) ##

## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloudbuildv2_repository ##
resource "google_cloudbuildv2_repository" "cloudbuildv2_repository" {
  project           = var.project_id
  location          = var.region
  name              = "${var.project_name}-${var.environment}-repo"
  parent_connection = var.github_connection_name
  remote_uri        = "https://github.com/${var.github_repository}.git"

  depends_on = [google_project_service.project_service]
}

## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloudbuild_trigger ##
## Cloud Run itself is owned by cloudbuild.deploy.yaml (gcloud run deploy), not by Terraform ##
resource "google_cloudbuild_trigger" "cloudbuild_branch_trigger" {
  project     = var.project_id
  location    = var.region
  name        = "${var.project_name}-${var.environment}-cloudbuild-trigger-server"
  description = "Build rafael-server and deploy Cloud Run on push"

  repository_event_config {
    repository = google_cloudbuildv2_repository.cloudbuildv2_repository.id
    push {
      branch = var.cloudbuild_trigger_branch_name
    }
  }

  approval_config {
    approval_required = var.cloudbuild_approval_required
  }

  substitutions = {
    _REGION                = var.region
    _SERVICE               = var.cloud_run_service_name
    _REPO                  = google_artifact_registry_repository.artifact_registry_repository.repository_id
    _MIN                   = tostring(var.min_instance_count)
    _MAX                   = tostring(var.max_instance_count)
    _RUNTIME_SA            = google_service_account.backend.email
    _ALLOWED_EXTENSION_IDS = join(",", var.allowed_extension_ids)
    _OAUTH_CLIENT_ID       = var.oauth_client_id
    _VERTEX_LOCATION       = var.vertex_location
    _STT_MODEL             = var.stt_model
    _STT_LOCATION          = var.stt_location
    _DETECTOR_MODEL        = var.detector_model
    _ANSWERER_MODEL        = var.answerer_model
    _ALLOWED_EMAILS        = join(",", var.allowed_emails)
    _SECRETS               = join(",", [for id in var.app_secret_ids : "${id}=${id}:latest"])
  }

  service_account = google_service_account.cloudbuild.id
  filename        = var.cloudbuild_file_name

  depends_on = [
    google_project_iam_member.cloudbuild_iam,
    google_service_account_iam_member.cloudbuild_act_as_backend,
  ]
}
