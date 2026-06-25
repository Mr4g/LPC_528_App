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
import { ProgramMappingService } from '../programs/programMappingStore';
import { createProgramMappingsRouter } from '../programs/programMappingsRouter';
import { CurrentTestStore } from '../scanner/currentTestStore';
import { createScannerRouter } from '../scanner/scannerRouter';
import { createAuthRouter } from './auth/authRouter';
import { attachAuth, requireAuth } from './auth/authMiddleware';
import { AuthService } from './auth/authService';
import { createDatabase } from './db/database';
import { createTestResultsRouter } from './test-results/testResultsRouter';
import { TestSessionManager } from './test-session/testSessionManager';
import { createTestSessionRouter } from './test-session/testSessionRouter';
import { createUsersRouter } from './users/usersRouter';

const config = loadConfig();
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
const database = createDatabase(config.SQLITE_DB_PATH);
const authService = new AuthService(database, config.AUTH_SESSION_SECRET);
authService.seedDefaultAdmin(config.DEFAULT_ADMIN_LOGIN, config.DEFAULT_ADMIN_PASSWORD);
const currentTestStore = new CurrentTestStore();
const programMappingService = new ProgramMappingService(database);
programMappingService.seedFromFallbackMap(config.BARCODE_PROGRAM_MAP);
const testSessionManager = new TestSessionManager(database, io, {
  activeTestTimeoutMs: config.ACTIVE_TEST_TIMEOUT_MS,
  noDataWarningMs: config.ACTIVE_TEST_NO_DATA_WARNING_MS,
});
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
const resultHistoryStore = new ResultHistoryStore(50);
const persistedResults = database.listTestResults({ limit: 50 }).results.map((result) => ({ ...result, currentTestValid: false }));
persistedResults.slice().reverse().forEach((result) => resultHistoryStore.add(result));
const persistedLastResult = database.getLastTestResult();
if (persistedLastResult) lastResultStore.set({ ...persistedLastResult, currentTestValid: false });
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
  debugPipeline: config.LPC_DEBUG_PIPELINE,
  database,
  testSessionManager,
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
app.use(attachAuth(authService));
app.use('/api/auth', createAuthRouter(authService));
app.use('/api/users', createUsersRouter(authService));
app.use('/api/test-results', createTestResultsRouter(database));
app.use('/api/test-session', createTestSessionRouter(testSessionManager));
app.use('/api/backup', createBackupRouter());
app.use('/api/programs', requireAuth, createProgramsRouter({ config, programStarter }));
app.use('/api/program-mappings', createProgramMappingsRouter(programMappingService));
app.use('/api/lpc', createLpcRouter({
  config,
  tcpClient: lpcTcpClient,
  lineProcessor: lpcLineProcessor,
  curveBuffer: lpcCurveBuffer,
  lastResultStore,
  resultHistoryStore,
  database,
  getSocketClientsCount: () => io.engine.clientsCount,
}));
app.use('/api', createScannerRouter({ config, io, programStarter, currentTestStore, programMappingService, testSessionManager }));

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
