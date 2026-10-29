## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret ##
## Holds the env's *.auto.tfvars (not in git). Upload: gcloud secrets versions add <id> --data-file=dev.auto.tfvars ##
resource "google_secret_manager_secret" "secret_manager_tfvars" {
  project   = var.project_id
  secret_id = "${var.project_name}-${var.environment}-infra-tfvars"

  replication {
    auto {}
  }

  labels = {
    environment  = var.environment
    project_name = var.project_name
  }

  depends_on = [google_project_service.project_service]
}

## App secrets mounted into Cloud Run (e.g. DEEPGRAM_API_KEY if BE-79 picks Deepgram). Values are added by hand, never in tfvars ##
resource "google_secret_manager_secret" "app_secret" {
  for_each = toset(var.app_secret_ids)

  project   = var.project_id
  secret_id = each.value

  replication {
    auto {}
  }

  labels = {
    environment  = var.environment
    project_name = var.project_name
  }

  depends_on = [google_project_service.project_service]
}
