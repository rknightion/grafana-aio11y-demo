import test from 'node:test';
import assert from 'node:assert/strict';
import { withScheduledLease } from './lease.mjs';

test('overlapping scheduled jobs cannot both enter the run-creation window', async () => {
  let lease;
  const request = async (method, _path, body) => {
    if (method === 'POST') {
      assert.match(body.spec.acquireTime, /\.\d{6}Z$/);
      assert.match(body.spec.renewTime, /\.\d{6}Z$/);
      if (lease) return { status: 409 };
      lease = { ...body, metadata: { ...body.metadata, resourceVersion: '1' } };
      return { status: 201, body: lease };
    }
    if (method === 'GET') return { status: lease ? 200 : 404, body: lease };
    if (method === 'PUT') {
      assert.match(body.spec.acquireTime, /\.\d{6}Z$/);
      assert.match(body.spec.renewTime, /\.\d{6}Z$/);
      assert.ok(body.spec.leaseDurationSeconds > 0);
      if (body.metadata.resourceVersion !== lease.metadata.resourceVersion) return { status: 409 };
      lease = { ...body, metadata: { ...body.metadata, resourceVersion: '2' } };
      return { status: 200, body: lease };
    }
    throw new Error(`unexpected ${method}`);
  };
  let enter;
  const entered = new Promise((resolve) => { enter = resolve; });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const first = withScheduledLease(async () => { enter(); await held; }, { request, holder: 'job-a' });
  await entered;
  let secondEntered = false;
  await assert.rejects(withScheduledLease(async () => { secondEntered = true; },
    { request, holder: 'job-b' }), /scheduled lease is held/);
  assert.equal(secondEntered, false);
  release();
  await first;
  await withScheduledLease(async () => { secondEntered = true; }, { request, holder: 'job-b' });
  assert.equal(secondEntered, true);
});

test('a release failure preserves the run error and its resume instructions', async () => {
  const pending = new Error('resume with --poll-evaluation-run run-123');
  const request = async (method, _path, body) => {
    if (method === 'POST') return { status: 201, body };
    if (method === 'GET') return { status: 500 };
    throw new Error(`unexpected ${method}`);
  };
  await assert.rejects(
    withScheduledLease(async () => { throw pending; }, { request, holder: 'job-a' }),
    (error) => error === pending && error.message.includes('--poll-evaluation-run run-123') &&
      error.leaseReleaseError === 'scheduled lease ownership changed before release',
  );
});
