import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/history-data.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const { mergeHistoryData } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

const oldSignature = "/api/signature/signature_previous.png";

test("preserves signature when incoming property is missing", () => {
  assert.equal(
    mergeHistoryData({ customerSignatureImage: oldSignature }, { name: "Updated" })
      .customerSignatureImage,
    oldSignature,
  );
});

test("preserves signature when incoming property is undefined", () => {
  assert.equal(
    mergeHistoryData(
      { customerSignatureImage: oldSignature },
      { customerSignatureImage: undefined },
    ).customerSignatureImage,
    oldSignature,
  );
});

test("preserves signature when incoming property is null", () => {
  assert.equal(
    mergeHistoryData(
      { customerSignatureImage: oldSignature },
      { customerSignatureImage: null },
    ).customerSignatureImage,
    oldSignature,
  );
});

test("preserves signature when incoming property is an empty string", () => {
  assert.equal(
    mergeHistoryData(
      { customerSignatureImage: oldSignature },
      { customerSignatureImage: "" },
    ).customerSignatureImage,
    oldSignature,
  );
});

test("preserves portal metadata not supplied by the update", () => {
  const merged = mergeHistoryData(
    { portalId: "portal-1", submissionSource: "customer-portal", customerReference: "REF-9" },
    { name: "Updated" },
  );
  assert.equal(merged.portalId, "portal-1");
  assert.equal(merged.submissionSource, "customer-portal");
  assert.equal(merged.customerReference, "REF-9");
});

test("updates ordinary fields while retaining unrelated old data", () => {
  const merged = mergeHistoryData(
    { name: "Old", amount: "10", portalMetadata: { active: true } },
    { name: "New", amount: "20" },
  );
  assert.equal(merged.name, "New");
  assert.equal(merged.amount, "20");
  assert.deepEqual(merged.portalMetadata, { active: true });
});

test("uses a nonempty replacement signature without validating it in the helper", () => {
  const replacement = "replacement-value";
  assert.equal(
    mergeHistoryData(
      { customerSignatureImage: oldSignature },
      { customerSignatureImage: replacement },
    ).customerSignatureImage,
    replacement,
  );
});

test("does not mutate either input object", () => {
  const previous = { customerSignatureImage: oldSignature, name: "Old" };
  const incoming = { customerSignatureImage: "", name: "New" };
  const previousBefore = structuredClone(previous);
  const incomingBefore = structuredClone(incoming);

  const merged = mergeHistoryData(previous, incoming);

  assert.deepEqual(previous, previousBefore);
  assert.deepEqual(incoming, incomingBefore);
  assert.notStrictEqual(merged, previous);
  assert.notStrictEqual(merged, incoming);
});
