// Lumen AI Insight — single-tenant deployment into the CLIENT's own Azure subscription.
//
// Everything runs in the client's resource group: the vendor has no access to
// it, its data or its secrets unless the client grants it (docs/VENDOR_ACCESS.md).
//
//   Log Analytics ─ Container Apps environment (VNet-integrated)
//                     ├─ web     (Next.js; internal ingress by default)
//                     ├─ worker  (sync + content scan + analysis; no ingress)
//                     └─ setup   (manual job: schema push / migrations)
//   PostgreSQL Flexible Server (private access only, in the VNet)
//   Key Vault (RBAC, private endpoint) ← secrets read by a user-assigned identity
//
// Deploy:  az deployment group create -g <rg> -f deploy/azure/main.bicep -p @deploy/azure/main.parameters.example.json
// See docs/DEPLOYMENT.md.

targetScope = 'resourceGroup'

@description('Azure region (defaults to the resource group region). For NZ data residency use newzealandnorth.')
param location string = resourceGroup().location

@description('Short prefix for resource names (lowercase letters/digits).')
@minLength(3)
@maxLength(12)
param namePrefix string = 'lumen'

@description('Container image for the web app, e.g. <registry>.azurecr.io/lumen-web:1.0.0')
param webImage string

@description('Container image for the worker, e.g. <registry>.azurecr.io/lumen-worker:1.0.0')
param workerImage string

@description('Private registry server (e.g. contoso.azurecr.io). Grant AcrPull on it to the identity output by this template. Empty = public images.')
param registryServer string = ''

@description('Expose the web app to the internet. Default false: reachable only from the VNet / peered networks / VPN.')
param webIngressExternal bool = false

@description('When external, restrict ingress to these CIDR ranges (e.g. office egress IPs). Empty = no restriction.')
param allowedIpRanges array = []

@description('Public URL users open (NEXTAUTH_URL), e.g. https://lumen.contoso.co.nz')
param appUrl string

@description('PostgreSQL administrator login.')
param postgresAdminLogin string = 'lumenadmin'

@secure()
@description('PostgreSQL administrator password.')
param postgresAdminPassword string

@secure()
@description('NextAuth session secret (openssl rand -base64 32).')
param nextAuthSecret string

@description('Entra tenant id of the analysed Microsoft 365 tenant (Graph connector).')
param graphTenantId string

@description('Client id of the read-only Graph app registration.')
param graphClientId string

@secure()
@description('Client secret of the Graph app registration.')
param graphClientSecret string

@description('Optional SSO for the app itself (Entra app registration). Empty = email/password only.')
param ssoClientId string = ''

@secure()
param ssoClientSecret string = ''

@description('LLM classification: none | azure-openai | openai-compatible. Default none (no LLM).')
@allowed(['none', 'azure-openai', 'openai-compatible'])
param llmProvider string = 'none'

@description('Azure OpenAI endpoint IN THIS SUBSCRIPTION, e.g. https://contoso-aoai.openai.azure.com')
param azureOpenAiEndpoint string = ''

param azureOpenAiDeployment string = ''

@secure()
param azureOpenAiApiKey string = ''

@description('Opt-in vendor telemetry (anonymised counts). Default false. See docs/SECURITY.md.')
param telemetryEnabled bool = false

param telemetryEndpoint string = ''

@description('Worker sync interval in minutes.')
param syncIntervalMinutes int = 360

param tags object = {
  application: 'lumen-ai-insight'
}

var suffix = uniqueString(resourceGroup().id, namePrefix)
var kvName = take('${namePrefix}kv${suffix}', 24)
var pgName = '${namePrefix}-pg-${suffix}'
var useAoai = llmProvider == 'azure-openai' && !empty(azureOpenAiApiKey)
var useSso = !empty(ssoClientId) && !empty(ssoClientSecret)

// ---------------------------------------------------------------- monitoring
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs-${suffix}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ---------------------------------------------------------------- network
resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${namePrefix}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.60.0.0/16'] }
    subnets: [
      {
        name: 'apps'
        properties: {
          addressPrefix: '10.60.0.0/23'
          delegations: [{ name: 'aca', properties: { serviceName: 'Microsoft.App/environments' } }]
        }
      }
      {
        name: 'postgres'
        properties: {
          addressPrefix: '10.60.2.0/24'
          delegations: [
            { name: 'pg', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }
          ]
        }
      }
      {
        name: 'private-endpoints'
        properties: { addressPrefix: '10.60.3.0/24' }
      }
    ]
  }
}

resource pgDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: '${namePrefix}.private.postgres.database.azure.com'
  location: 'global'
  tags: tags
}

resource pgDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: pgDns
  name: 'vnet'
  location: 'global'
  properties: {
    virtualNetwork: { id: vnet.id }
    registrationEnabled: false
  }
}

resource kvDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.vaultcore.azure.net'
  location: 'global'
  tags: tags
}

resource kvDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: kvDns
  name: 'vnet'
  location: 'global'
  properties: {
    virtualNetwork: { id: vnet.id }
    registrationEnabled: false
  }
}

// ---------------------------------------------------------------- database
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: pgName
  location: location
  tags: tags
  sku: { name: 'Standard_B2s', tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: 64, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: 14, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: {
      delegatedSubnetResourceId: vnet.properties.subnets[1].id
      privateDnsZoneArmResourceId: pgDns.id
      publicNetworkAccess: 'Disabled'
    }
  }
  dependsOn: [pgDnsLink]
}

resource pgDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: pg
  name: 'lumen'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// ---------------------------------------------------------------- identity + secrets
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-id-${suffix}'
  location: location
  tags: tags
}

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 30
    enablePurgeProtection: true
    publicNetworkAccess: 'Disabled'
    networkAcls: { defaultAction: 'Deny', bypass: 'AzureServices' }
  }
}

resource kvPe 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: '${kvName}-pe'
  location: location
  tags: tags
  properties: {
    subnet: { id: vnet.properties.subnets[2].id }
    privateLinkServiceConnections: [
      {
        name: 'kv'
        properties: { privateLinkServiceId: kv.id, groupIds: ['vault'] }
      }
    ]
  }
}

resource kvPeDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: kvPe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [{ name: 'vault', properties: { privateDnsZoneId: kvDns.id } }]
  }
}

// Key Vault Secrets User for the app identity only.
resource kvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, identity.id, 'kv-secrets-user')
  scope: kv
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6'
    )
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

var databaseUrl = 'postgresql://${postgresAdminLogin}:${uriComponent(postgresAdminPassword)}@${pg.properties.fullyQualifiedDomainName}:5432/${pgDb.name}?sslmode=require'

resource secDb 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'database-url'
  properties: { value: databaseUrl }
}

resource secAuth 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'nextauth-secret'
  properties: { value: nextAuthSecret }
}

resource secGraph 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'graph-client-secret'
  properties: { value: graphClientSecret }
}

resource secAoai 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (useAoai) {
  parent: kv
  name: 'azure-openai-api-key'
  properties: { value: azureOpenAiApiKey }
}

resource secSso 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (useSso) {
  parent: kv
  name: 'sso-client-secret'
  properties: { value: ssoClientSecret }
}

// ---------------------------------------------------------------- container apps
resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-env-${suffix}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: vnet.properties.subnets[0].id
      internal: !webIngressExternal
    }
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    zoneRedundant: false
  }
}

var secretNames = concat(
  ['database-url', 'nextauth-secret', 'graph-client-secret'],
  useAoai ? ['azure-openai-api-key'] : [],
  useSso ? ['sso-client-secret'] : []
)

// Container Apps read these from Key Vault with the user-assigned identity at runtime.
var commonSecrets = map(secretNames, n => {
  name: n
  keyVaultUrl: '${kv.properties.vaultUri}secrets/${n}'
  identity: identity.id
})

var commonEnv = concat(
  [
    { name: 'DATABASE_URL', secretRef: 'database-url' }
    { name: 'NEXTAUTH_SECRET', secretRef: 'nextauth-secret' }
    { name: 'NEXTAUTH_URL', value: appUrl }
    { name: 'GRAPH_TENANT_ID', value: graphTenantId }
    { name: 'GRAPH_CLIENT_ID', value: graphClientId }
    { name: 'GRAPH_CLIENT_SECRET', secretRef: 'graph-client-secret' }
    { name: 'LLM_PROVIDER', value: llmProvider }
    { name: 'TELEMETRY_ENABLED', value: string(telemetryEnabled) }
    { name: 'TELEMETRY_ENDPOINT', value: telemetryEndpoint }
    { name: 'SYNC_INTERVAL_MINUTES', value: string(syncIntervalMinutes) }
    { name: 'NEXT_TELEMETRY_DISABLED', value: '1' }
    { name: 'CHECKPOINT_DISABLE', value: '1' }
  ],
  useAoai
    ? [
        { name: 'AZURE_OPENAI_ENDPOINT', value: azureOpenAiEndpoint }
        { name: 'AZURE_OPENAI_DEPLOYMENT', value: azureOpenAiDeployment }
        { name: 'AZURE_OPENAI_API_KEY', secretRef: 'azure-openai-api-key' }
      ]
    : [],
  useSso
    ? [
        { name: 'AZURE_AD_CLIENT_ID', value: ssoClientId }
        { name: 'AZURE_AD_CLIENT_SECRET', secretRef: 'sso-client-secret' }
        { name: 'AZURE_AD_TENANT_ID', value: subscription().tenantId }
      ]
    : []
)

var registries = empty(registryServer) ? [] : [{ server: registryServer, identity: identity.id }]

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-web'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      ingress: {
        external: true // "external" to the environment; the environment itself is internal unless webIngressExternal
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        ipSecurityRestrictions: [
          for (cidr, i) in allowedIpRanges: {
            name: 'allow-${i}'
            action: 'Allow'
            ipAddressRange: cidr
          }
        ]
      }
      secrets: commonSecrets
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: commonEnv
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/api/health', port: 3000 }
              periodSeconds: 30
            }
          ]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 2 }
    }
  }
  dependsOn: [kvRole, secDb, secAuth, secGraph, secAoai, secSso]
}

resource worker 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-worker'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      secrets: commonSecrets
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: workerImage
          // Content extraction happens in memory: give the worker headroom.
          resources: { cpu: json('1.0'), memory: '2Gi' }
          env: commonEnv
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
  dependsOn: [kvRole, secDb, secAuth, secGraph, secAoai, secSso]
}

// Run once after each deploy/upgrade: `az containerapp job start -g <rg> -n <prefix>-setup`
resource setup 'Microsoft.App/jobs@2024-03-01' = {
  name: '${namePrefix}-setup'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 1800
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      secrets: commonSecrets
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'setup'
          image: workerImage
          command: ['npm', 'run', 'db:push']
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: commonEnv
        }
      ]
    }
  }
  dependsOn: [kvRole, secDb, secAuth, secGraph, secAoai, secSso]
}

output webUrl string = 'https://${web.properties.configuration.ingress.fqdn}'
output environmentStaticIp string = env.properties.staticIp
output identityPrincipalId string = identity.properties.principalId
output identityResourceId string = identity.id
output keyVaultName string = kv.name
output postgresServer string = pg.properties.fullyQualifiedDomainName
