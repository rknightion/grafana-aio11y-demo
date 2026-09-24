{{/*
Prefix for every object this chart creates. Deliberately independent of .Release.Name: Terraform
sets nameOverride to var.name and every other lane's frozen names (IAM, Pod Identity, Secrets)
are built from that same var.name, not from whatever Helm release name the installer picks.
*/}}
{{- define "touchline.prefix" -}}
{{- .Values.nameOverride | default .Chart.Name -}}
{{- end -}}

{{/*
"<prefix>-<suffix>" object name, e.g. touchline-orchestrator.
*/}}
{{- define "touchline.objectName" -}}
{{- printf "%s-%s" (include "touchline.prefix" .context) .suffix -}}
{{- end -}}

{{/*
Common labels for every object.
*/}}
{{- define "touchline.labels" -}}
app.kubernetes.io/part-of: {{ include "touchline.prefix" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{/*
Selector labels for a named component (Deployment/Service/CronJob must agree on these).
*/}}
{{- define "touchline.selectorLabels" -}}
app.kubernetes.io/name: {{ . }}
{{- end -}}

{{/*
Full OTEL_RESOURCE_ATTRIBUTES value for a given service name.
*/}}
{{- define "touchline.resourceAttributes" -}}
{{- printf "service.namespace=%s,deployment.environment=%s" .root.Values.namespace .root.Values.deploymentEnvironment -}}
{{- end -}}

{{/*
AGENTO11Y_CONTENT_CAPTURE_MODE value from the contentCapture bool.
*/}}
{{- define "touchline.contentCaptureMode" -}}
{{- if .Values.contentCapture -}}full{{- else -}}none{{- end -}}
{{- end -}}
