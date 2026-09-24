// A coordination.k8s.io Lease that keeps overlapping scheduled experiment Jobs out of the
// run-creation window. Needs RBAC: get, create and update on leases in the Job's namespace.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { serviceNamespace } from '../src/config.mjs';

const SA_DIR = '/var/run/secrets/kubernetes.io/serviceaccount';
// The Job deadline is 10800 seconds. A dead pod's lock expires shortly after that deadline.
const leaseDurationSeconds = 10920;

async function kubernetesNamespace(env = process.env) {
  if (env.POD_NAMESPACE) return env.POD_NAMESPACE;
  return (await readFile(`${SA_DIR}/namespace`, 'utf8')).trim();
}
const microTime = (millis) => new Date(millis).toISOString().replace(/Z$/, '000Z');

async function kubernetesRequest(method, path, body) {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  if (!host) throw new Error('Kubernetes service host is required for scheduled lease');
  const port = process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? '443';
  const token = (await readFile(`${SA_DIR}/token`, 'utf8')).trim();
  if (!token) throw new Error('Kubernetes service account token is required for scheduled lease');
  const hostPart = host.includes(':') ? `[${host}]` : host;
  const response = await fetch(`https://${hostPart}:${port}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: response.ok ? await response.json() : undefined };
}

function heldUntil(lease) {
  const since = Date.parse(lease?.spec?.renewTime ?? lease?.spec?.acquireTime ?? '');
  const duration = lease?.spec?.leaseDurationSeconds;
  if (!Number.isFinite(since) || !Number.isInteger(duration) || duration < 0) {
    throw new Error('scheduled lease has invalid expiry; refusing to create runs');
  }
  return since + duration * 1000;
}

export async function withScheduledLease(run, { request = kubernetesRequest, holder = randomUUID(), now = () => Date.now(), namespace, name = `${serviceNamespace()}-experiments` } = {}) {
  namespace ??= request === kubernetesRequest ? await kubernetesNamespace() : 'test';
  const collection = `/apis/coordination.k8s.io/v1/namespaces/${namespace}/leases`;
  const item = `${collection}/${name}`;
  const time = microTime(now());
  const spec = { holderIdentity: holder, acquireTime: time, renewTime: time, leaseDurationSeconds };
  let response = await request('POST', collection, { apiVersion: 'coordination.k8s.io/v1', kind: 'Lease',
    metadata: { name, namespace }, spec });
  if (response.status === 409) {
    response = await request('GET', item);
    if (response.status !== 200 || !response.body?.metadata?.resourceVersion) throw new Error(`scheduled lease lookup returned HTTP ${response.status}`);
    const current = response.body;
    if (current.spec?.holderIdentity && now() < heldUntil(current)) throw new Error('scheduled lease is held by another job');
    response = await request('PUT', item, { ...current, spec: { ...current.spec, ...spec } });
    if (response.status === 409) throw new Error('scheduled lease was claimed concurrently');
  }
  if (![200, 201].includes(response.status)) throw new Error(`scheduled lease acquisition returned HTTP ${response.status}`);
  const release = async () => {
    const current = await request('GET', item);
    if (current.status !== 200 || !current.body?.metadata?.resourceVersion || current.body.spec?.holderIdentity !== holder) {
      throw new Error('scheduled lease ownership changed before release');
    }
    const released = await request('PUT', item, { ...current.body, spec: { ...current.body.spec,
      holderIdentity: '', leaseDurationSeconds, renewTime: microTime(now()) } });
    if (released.status !== 200) throw new Error(`scheduled lease release returned HTTP ${released.status}`);
  };
  let result;
  try {
    result = await run();
  } catch (error) {
    try { await release(); } catch (releaseError) { error.leaseReleaseError = releaseError.message; }
    throw error;
  }
  await release();
  return result;
}
