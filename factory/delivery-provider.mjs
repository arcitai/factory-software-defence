import { githubDeliveryProvider } from './providers/github-delivery.mjs';

// Provider selection is a trusted installation setting. Unknown providers do
// not get guessed URLs, credentials or a write path; they remain patch-only.
export function deliveryProvider(config, integrations = {}) {
  const provider = config.delivery?.provider;
  if (provider !== 'github') return { id: provider || null, supported: false };
  return integrations.deliveryProvider || githubDeliveryProvider();
}

export function deliveryProviderInfo(config, provider) {
  const enabled = provider?.supported === true && config.delivery?.provider === provider.id;
  return {
    enabled,
    mode: enabled ? 'trusted_pr' : 'patch_only',
    provider: config.delivery?.provider || null,
    repository: enabled ? config.delivery.repository : null,
    target: enabled ? config.delivery.target : null,
  };
}
