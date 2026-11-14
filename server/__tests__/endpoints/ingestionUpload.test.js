jest.mock("../../utils/http", () => ({
  reqBody: (request) => request.body,
  safeJsonParse: JSON.parse,
}));
jest.mock("../../utils/files", () => ({
  moveProcessedDocsToFolder: jest.fn(),
}));
jest.mock("../../utils/collectorApi", () => ({ CollectorApi: jest.fn() }));
jest.mock("../../models/workspace", () => ({ Workspace: {} }));
jest.mock("../../models/documents", () => ({ Document: {} }));
jest.mock("../../models/vectors", () => ({}));
jest.mock("../../models/workspaceChats", () => ({}));
jest.mock("../../models/user", () => ({}));
jest.mock("../../utils/helpers", () => ({}));
jest.mock("../../utils/files/multer", () => ({}));
jest.mock("../../utils/helpers/reasoningEffort", () => ({}));
jest.mock("../../utils/middleware/validatedRequest", () => ({}));
jest.mock("../../models/telemetry", () => ({
  Telemetry: { sendTelemetry: jest.fn() },
}));
jest.mock("../../utils/middleware/multiUserProtected", () => ({
  ROLES: {},
  flexUserRoleValid: jest.fn(),
}));
jest.mock("../../models/eventLogs", () => ({
  EventLogs: { logEvent: jest.fn() },
}));
jest.mock("../../models/workspacesSuggestedMessages", () => ({}));
jest.mock("../../utils/middleware/validWorkspace", () => ({}));
jest.mock("../../utils/helpers/chat/responses", () => ({}));
jest.mock("../../utils/TextToSpeech", () => ({}));
jest.mock("../../utils/TextToSpeech/audioFormat", () => ({}));
jest.mock("../../utils/TextToSpeech/messageToSpeech", () => ({}));
jest.mock("../../models/workspaceThread", () => ({}));
jest.mock("../../utils/files/purgeDocument", () => ({}));
jest.mock("../../endpoints/utils", () => ({}));
jest.mock("../../utils/helpers/search", () => ({}));
jest.mock("../../endpoints/workspacesParsedFiles", () => ({
  workspaceParsedFilesEndpoints: jest.fn(),
}));
jest.mock("../../utils/middleware/workspaceDeletionProtection", () => ({}));

const { workspaceEndpoints } = require("../../endpoints/workspaces");
const { CollectorApi } = require("../../utils/collectorApi");
const { moveProcessedDocsToFolder } = require("../../utils/files");
let handler;
let response;
let processDocument;
beforeEach(() => {
  jest.clearAllMocks();
  processDocument = jest.fn();
  CollectorApi.mockImplementation(() => ({
    online: async () => true,
    processDocument,
    log: jest.fn(),
  }));
  const app = {
    post: jest.fn(),
    get: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  };
  workspaceEndpoints(app);
  handler = app.post.mock.calls.find(
    ([url]) => url === "/workspace/:slug/upload"
  )[2];
  response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    end: jest.fn(),
    locals: {},
  };
});
const request = {
  file: { originalname: "中文.pdf" },
  body: { folderName: "reports", metadata: '{"title":"中文报告"}' },
};

test("a partial PDF import reaches the UI with a named warning even after a folder move", async () => {
  const documents = [
    {
      title: "中文报告",
      ingestionWarning: "1 of 3 PDF pages have no usable text.",
    },
  ];
  processDocument.mockResolvedValue({
    success: true,
    documents,
    ingestionStatus: "partial",
  });
  await handler(request, response);
  expect(processDocument).toHaveBeenCalledWith("中文.pdf", {
    title: "中文报告",
  });
  expect(moveProcessedDocsToFolder).toHaveBeenCalledWith(documents, "reports");
  expect(response.json).toHaveBeenCalledWith({
    success: true,
    error: null,
    warnings: ["中文报告: 1 of 3 PDF pages have no usable text."],
  });
});

test("a failed import preserves its report ID for diagnosis", async () => {
  processDocument.mockResolvedValue({
    success: false,
    reason: "No text",
    documents: [],
    ingestionStatus: "failed",
    ingestionReportId: "a".repeat(64),
  });
  await handler(request, response);
  expect(response.status).toHaveBeenCalledWith(500);
  expect(response.json).toHaveBeenCalledWith({
    success: false,
    error: "No text",
    ingestionStatus: "failed",
    ingestionReportId: "a".repeat(64),
  });
  expect(moveProcessedDocsToFolder).not.toHaveBeenCalled();
});

test("older converters remain compatible when no ingestion diagnostics are returned", async () => {
  processDocument.mockResolvedValue({
    success: true,
    documents: [{ title: "Old converter" }],
  });
  await handler(request, response);
  expect(response.json).toHaveBeenCalledWith({
    success: true,
    error: null,
    warnings: [],
  });
});
