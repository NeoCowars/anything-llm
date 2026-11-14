jest.mock("../../models/documents", () => ({ Document: {} }));
jest.mock("../../utils/files", () => ({ fileData: jest.fn() }));
jest.mock("../../utils/http", () => ({ reqBody: (request) => request.body }));
jest.mock("../../utils/ingestionReports", () => ({
  readIngestionReport: jest.fn(),
}));
jest.mock("../../utils/middleware/multiUserProtected", () => ({
  ROLES: { admin: "admin", manager: "manager" },
  flexUserRoleValid: jest.fn(() => (_request, _response, next) => next()),
}));
jest.mock("../../utils/middleware/validatedRequest", () => ({
  validatedRequest: jest.fn(),
}));
const { documentEndpoints } = require("../../endpoints/document");
const { fileData } = require("../../utils/files");
const { readIngestionReport } = require("../../utils/ingestionReports");
const {
  flexUserRoleValid,
} = require("../../utils/middleware/multiUserProtected");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");

let handler;
let response;
beforeEach(() => {
  jest.clearAllMocks();
  const app = { post: jest.fn() };
  documentEndpoints(app);
  const route = app.post.mock.calls.find(
    ([url]) => url === "/document/ingestion-report"
  );
  expect(route[1][0]).toBe(validatedRequest);
  expect(flexUserRoleValid).toHaveBeenCalledWith(["admin", "manager"]);
  handler = route[2];
  response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
});

test("a document report is resolved through the existing document path checks", async () => {
  fileData.mockResolvedValue({ ingestionReportId: "a".repeat(64) });
  readIngestionReport.mockReturnValue({ status: "partial", pages: [] });
  await handler(
    { body: { docpath: "custom-documents/example.json" } },
    response
  );
  expect(fileData).toHaveBeenCalledWith("custom-documents/example.json");
  expect(response.status).toHaveBeenCalledWith(200);
  expect(response.json).toHaveBeenCalledWith({
    success: true,
    report: { status: "partial", pages: [] },
  });
});

test("a failed import report can be read using its opaque id", async () => {
  readIngestionReport.mockReturnValue({ status: "failed" });
  await handler({ body: { reportId: "a".repeat(64) } }, response);
  expect(fileData).not.toHaveBeenCalled();
  expect(response.status).toHaveBeenCalledWith(200);
});

test.each([
  {},
  { reportId: "../secret" },
  { reportId: ["a".repeat(64)] },
  { reportId: null },
  { reportId: "" },
  { docpath: 10 },
])("invalid input %p is rejected", async (body) => {
  await handler({ body }, response);
  expect(response.status).toHaveBeenCalledWith(400);
  expect(readIngestionReport).not.toHaveBeenCalled();
});

test("older documents without reports return 404", async () => {
  fileData.mockResolvedValue({ title: "Old document" });
  readIngestionReport.mockReturnValue(null);
  await handler({ body: { docpath: "custom-documents/old.json" } }, response);
  expect(response.status).toHaveBeenCalledWith(404);
});
