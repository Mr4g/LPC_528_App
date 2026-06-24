import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { loadConfig } from '../config';
import { createBackupRouter } from '../backup/routes';
import { LastResultStore } from '../lpc/LastResultStore';
import { createLpcRouter } from '../lpc/lpcRouter';
import { LpcLineProcessor } from '../lpc/LpcLineProcessor';
import { LpcTcpClient } from '../lpc/LpcTcpClient';
import { LpcTestCurveBuffer } from '../lpc/LpcTestCurveBuffer';
import { ResultHistoryStore } from '../lpc/ResultHistoryStore';
import { createProgramStarter } from '../programs/ProgramStarter';
import { createProgramsRouter } from '../programs/programsRouter';
import { CurrentTestStore } from '../scanner/currentTestStore';
import { createScannerRouter } from '../scanner/scannerRouter';

const config = loadConfig();
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
const currentTestStore = new CurrentTestStore();
const programStarter = createProgramStarter({
  mode: config.PROGRAM_START_MODE,
  command: config.PROGRAM_START_COMMAND,
  scriptPath: config.PROGRAM_START_SCRIPT_PATH,
});
const lpcTcpClient = new LpcTcpClient({
  host: config.LPC_HOST,
  port: config.LPC_PORT,
  autoConnect: config.LPC_AUTO_CONNECT,
  reconnectEnabled: config.LPC_RECONNECT_ENABLED,
  reconnectDelayMs: config.LPC_RECONNECT_DELAY_MS,
  connectTimeoutMs: config.LPC_CONNECT_TIMEOUT_MS,
  heartbeatEnabled: config.LPC_HEARTBEAT_ENABLED,
  heartbeatIntervalMs: config.LPC_HEARTBEAT_INTERVAL_MS,
  heartbeatTimeoutMs: config.LPC_HEARTBEAT_TIMEOUT_MS,
  staleConnectionTimeoutMs: config.LPC_STALE_CONNECTION_TIMEOUT_MS,
  heartbeatPayload: config.LPC_HEARTBEAT_PAYLOAD,
});
const lpcCurveBuffer = new LpcTestCurveBuffer({
  maxPoints: config.LPC_STREAM_BUFFER_LIMIT,
  minElapsedStepSec: config.LPC_MIN_ELAPSED_STEP_SEC,
});
const lastResultStore = new LastResultStore();
const resultHistoryStore = new ResultHistoryStore(20);
const lpcLineProcessor = new LpcLineProcessor({
  io,
  tcpClient: lpcTcpClient,
  currentTestStore,
  curveBuffer: lpcCurveBuffer,
  lastResultStore,
  resultHistoryStore,
  autoSelectInterface: config.LPC_AUTO_SELECT_INTERFACE,
  interfaceSelection: config.LPC_INTERFACE_SELECTION,
  currentTestMaxAgeMs: config.CURRENT_TEST_MAX_AGE_MS,
  debugLines: config.LPC_DEBUG_LINES,
});

lpcTcpClient.on('status', (state) => {
  io.emit('lpc:status', state);
});
lpcTcpClient.on('connected', (state) => {
  io.emit('lpc:connected', state);
});
lpcTcpClient.on('disconnected', (state) => {
  io.emit('lpc:disconnected', state);
});
lpcTcpClient.on('reconnecting', (state) => {
  io.emit('lpc:reconnecting', state);
});
lpcTcpClient.on('error', (error, state) => {
  io.emit('lpc:error', { message: error.message, state });
});
lpcTcpClient.on('rawData', (data) => {
  if (data.includes('TCP/IP INTERFACE SELECTION') || data.includes('* 1 Interface Connection1 *')) {
    lpcLineProcessor.processLine(data);
  }
});
lpcTcpClient.on('line', (line) => {
  lpcLineProcessor.processLine(line);
});

app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});
app.use(express.json());
app.use('/api/backup', createBackupRouter());
app.use('/api/programs', createProgramsRouter({ config, programStarter }));
app.use('/api/lpc', createLpcRouter({
  config,
  tcpClient: lpcTcpClient,
  lineProcessor: lpcLineProcessor,
  curveBuffer: lpcCurveBuffer,
  lastResultStore,
  resultHistoryStore,
}));
app.use('/api', createScannerRouter({ config, io, programStarter, currentTestStore }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'lpc-528-app' });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'lpc-528-app' });
});

io.on('connection', (socket) => {
  socket.emit('status', { connected: true });
});

httpServer.listen(config.APP_PORT, () => {
  console.log(`LPC-528 backend listening on port ${config.APP_PORT}`);
  if (config.LPC_AUTO_CONNECT) {
    lpcTcpClient.connect();
  }
});
