{{/*
Expand the name of the chart.
*/}}
{{- define "teleport-access-graph.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "teleport-access-graph.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "teleport-access-graph.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "teleport-access-graph.labels" -}}
helm.sh/chart: {{ include "teleport-access-graph.chart" . }}
{{ include "teleport-access-graph.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "teleport-access-graph.selectorLabels" -}}
app.kubernetes.io/name: {{ include "teleport-access-graph.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "teleport-access-graph.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "teleport-access-graph.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "teleport-access-graph.mergePostgresParams" -}}
{{- $connParams := .connection_parameters }}
{{- $merged := dict }}
{{- if $connParams }}
  {{- $merged = merge $merged $connParams }}
{{- end }}
{{- $iamEnabled := .aws.enabled | default false }}
{{- if $iamEnabled }}
{{- $awsData := dict }}
  {{- if .aws.region }}
    {{- $_ := set $awsData "region" .aws.region }}
  {{- end }}
  {{- $merged = merge $merged (dict "aws" $awsData) }}
{{- end }}
{{- $azureEnabled := .azure.enabled | default false }}
{{- if $azureEnabled }}
{{- $azureData := dict }}
  {{- if .azure.tenantId }}
    {{- $_ := set $azureData "tenant_id" .azure.tenantId }}
  {{- end }}
  {{- $merged = merge $merged (dict "azure" $azureData) }}
{{- end }}
{{- $merged | toYaml}}
{{- end }}
