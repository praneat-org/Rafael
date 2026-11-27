output "service_account_emails" {
  description = "Map of service account name to email address"
  value = {
    cloudbuild = google_service_account.cloudbuild.email
    backend    = google_service_account.backend.email
  }
}

output "artifact_registry_path" {
  description = "Image path for rafael-server"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.artifact_registry_repository.repository_id}/rafael-server"
}

output "custom_domain_ip" {
  description = "Load balancer IP: add an A record <custom_domain> -> this IP (null when custom_domain is empty)"
  value       = try(google_compute_global_address.web["web"].address, null)
}

output "cloudbuild_trigger_name" {
  description = "Cloud Build trigger name"
  value       = google_cloudbuild_trigger.cloudbuild_branch_trigger.name
}
