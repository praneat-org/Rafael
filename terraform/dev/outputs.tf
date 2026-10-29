## Values for the BE-71 comment (none are secret) ##
output "service_account_emails" {
  description = "Service account emails"
  value       = module.app.service_account_emails
}

output "artifact_registry_path" {
  description = "Image path for rafael-server"
  value       = module.app.artifact_registry_path
}

output "cloudbuild_trigger_name" {
  description = "Cloud Build trigger name"
  value       = module.app.cloudbuild_trigger_name
}
