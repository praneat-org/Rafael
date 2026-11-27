## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/google_project_iam ##
resource "google_project_iam_member" "cloudbuild_iam" {
  for_each = toset(var.cloudbuild_sa_role)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.cloudbuild.email}"
}

resource "google_project_iam_member" "backend_iam" {
  for_each = toset(var.backend_sa_role)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.backend.email}"
}

## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/google_service_account_iam ##
## Cloud Build deploys Cloud Run as the backend SA (gcloud run deploy --service-account) ##
resource "google_service_account_iam_member" "cloudbuild_act_as_backend" {
  service_account_id = google_service_account.backend.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.cloudbuild.email}"
}
