import { computeCanonicalId, resolveCanonicalIds } from './src/v2/utils/canonical-id';

console.log("=== Canonical ID Generation Demo ===");
console.log("Namespace (Stripe):");
console.log("- computeCanonicalId('Stripe', 'GET', '/customers') -> " + computeCanonicalId('Stripe', 'GET', '/customers'));
console.log("- computeCanonicalId('Stripe', 'POST', '/customers/{id}/cancel') -> " + computeCanonicalId('Stripe', 'POST', '/customers/{id}/cancel'));
console.log("- computeCanonicalId('Stripe', 'POST', '/charges/{charge}/refund') -> " + computeCanonicalId('Stripe', 'POST', '/charges/{charge}/refund'));

console.log("\nCollision Resolution (Fallback to .1, .2):");
const methods = [
  { methodId: 'getAccounts', httpMethod: 'GET', endpoint: '/accounts' },
  { methodId: 'getAccountsFilter', httpMethod: 'GET', endpoint: '/accounts' },
  { methodId: 'getAccountsAdvanced', httpMethod: 'GET', endpoint: '/accounts' },
];
const ids = resolveCanonicalIds(methods, 'Aws');
for (const [methodId, canonicalId] of ids.entries()) {
    console.log(\`- \${methodId} -> \${canonicalId}\`);
}
