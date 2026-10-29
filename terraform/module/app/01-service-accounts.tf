## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/google_service_account ##
resource "google_service_account" "cloudbuild" {
  account_id   = "${var.project_name}-${var.environment}-cloudbuild"
  display_name = "Cloud Build Service Account"
  project      = var.project_id

  depends_on = [google_project_service.project_service]
}

## Cloud Run runtime identity: Vertex AI (ADC) + mounted secrets. No Storage roles (D11) ##
resource "google_service_account" "backend" {
  account_id   = "${var.project_name}-${var.environment}-backend"
  display_name = "Cloud Run Backend Service Account"
  project      = var.project_id

  depends_on = [google_project_service.project_service]
}
