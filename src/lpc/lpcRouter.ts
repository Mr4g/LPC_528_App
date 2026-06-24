import { Router } from 'express';
import type { AppConfig } from '../config';
import { checkLpcPort } from './checkLpcPort';
import type { LastResultStore } from './LastResultStore';
import type { LpcLineProcessor } from './LpcLineProcessor';
import type { ResultHistoryStore } from './ResultHistoryStore';
import type { LpcTcpClient } from './LpcTcpClient';
import type { LpcTestCurveBuffer } from './LpcTestCurveBuffer';

export function createLpcRouter(options: {
  config: AppConfig;
  tcpClient: LpcTcpClient;
  lineProcessor: LpcLineProcessor;
  curveBuffer: LpcTestCurveBuffer;
  lastResultStore: LastResultStore;
  resultHistoryStore: ResultHistoryStore;
}): Router {
  const router = Router();

  router.get('/status', (_req, res) => {
    const state = options.tcpClient.getState();
    res.json({
      ok: true,
      connected: state.connected,
      status: state.status,
      host: state.host,
      port: state.port,
      autoConnect: state.autoConnect,
      reconnectEnabled: state.reconnectEnabled,
      reconnectDelayMs: state.reconnectDelayMs,
      connectTimeoutMs: state.connectTimeoutMs,
      lastConnectionAttemptAt: state.lastConnectionAttemptAt,
      lastConnectedAt: state.lastConnectedAt,
      lastDisconnectedAt: state.lastDisconnectedAt,
      lastError: state.lastError,
      reconnectAttemptCount: state.reconnectAttemptCount,
      nextReconnectAt: state.nextReconnectAt,
      lastDataReceivedAt: state.lastDataReceivedAt,
      lastSuccessfulWriteAt: state.lastSuccessfulWriteAt,
      lastHeartbeatAt: state.lastHeartbeatAt,
      heartbeatEnabled: state.heartbeatEnabled,
      heartbeatIntervalMs: state.heartbeatIntervalMs,
      heartbeatTimeoutMs: state.heartbeatTimeoutMs,
      staleConnectionTimeoutMs: state.staleConnectionTimeoutMs,
      staleConnectionDetectedAt: state.staleConnectionDetectedAt,
      socketDestroyed: state.socketDestroyed,
      socketWritable: state.socketWritable,
      lastRawLinesCount: options.lineProcessor.getLastRawLinesCount(),
      curvePointCount: options.curveBuffer.getPoints().length,
    });
  });

  router.post('/connect', (_req, res) => {
    const result = options.tcpClient.connect();
    res.status(result.ok ? 200 : 409).json(result);
  });

  router.post('/disconnect', (_req, res) => {
    const result = options.tcpClient.disconnect();
    res.json(result);
  });

  router.post('/send', (req, res) => {
    const data = typeof req.body?.data === 'string' ? req.body.data : null;
    if (!data) {
      return res.status(400).json({ ok: false, error: 'INVALID_DATA', message: 'Body data must be a non-empty string' });
    }

    try {
      options.tcpClient.send(data);
      return res.json({ ok: true, sentBytes: Buffer.byteLength(data) });
    } catch (error) {
      return res.status(409).json({
        ok: false,
        error: 'LPC_NOT_CONNECTED',
        message: error instanceof Error ? error.message : 'LPC TCP client is not connected',
      });
    }
  });

  router.post('/check-port', async (_req, res) => {
    const result = await checkLpcPort(options.config.LPC_HOST, options.config.LPC_PORT, options.config.LPC_CONNECT_TIMEOUT_MS);
    res.json(result);
  });

  router.post('/force-refresh-status', (_req, res) => {
    const state = options.tcpClient.forceRefreshStatus();
    res.json({ ok: true, state });
  });

  router.post('/heartbeat-test', async (_req, res) => {
    const result = await options.tcpClient.performHeartbeatCheck();
    res.status(result.ok ? 200 : 409).json(result);
  });

  router.post('/mock-line', (req, res) => {
    const enabled = options.config.NODE_ENV !== 'production' || options.config.ENABLE_MOCK_LPC_ENDPOINTS;
    if (!enabled) {
      return res.status(403).json({ ok: false, error: 'MOCK_LPC_ENDPOINT_DISABLED' });
    }

    const line = typeof req.body?.line === 'string' ? req.body.line : null;
    if (!line) {
      return res.status(400).json({ ok: false, error: 'INVALID_LINE', message: 'Body line must be a non-empty string' });
    }

    options.lineProcessor.processLine(line);
    return res.json({ ok: true, processed: true });
  });

  router.get('/last-result', (_req, res) => {
    res.json({ ok: true, result: options.lastResultStore.get() });
  });

  router.get('/results', (_req, res) => {
    res.json({ ok: true, results: options.resultHistoryStore.getAll() });
  });

  router.get('/raw-lines', (_req, res) => {
    res.json({ ok: true, lines: options.lineProcessor.getRawLines() });
  });

  router.get('/curve', (_req, res) => {
    res.json({ ok: true, points: options.curveBuffer.getPoints(), summary: options.curveBuffer.getSummary() });
  });

  return router;
}
