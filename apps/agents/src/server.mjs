// Entry point. AGENT_ROLE (or ROLE) selects what this process runs: one of the five agents (HTTP
// service on PORT, default 8080) or "loadgen" (the synthetic reader traffic generator).
import { currentRole } from './config.mjs';

const role = currentRole();

if (role === 'loadgen') {
  const { runLoadgenMain } = await import('./loadgen.mjs');
  await runLoadgenMain();
} else {
  const { createAgentService, createAgentHttpServer } = await import('./service.mjs');
  const service = createAgentService({ role });
  const server = createAgentHttpServer(service);
  const port = Number(process.env.PORT ?? '8080');
  server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'agent_listening', service: service.agentName, port })));
  async function stop() { server.close(); await service.shutdown(); }
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}
