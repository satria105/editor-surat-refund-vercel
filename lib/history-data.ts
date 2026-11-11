export type HistoryData = Record<string, unknown>;

/** Merge an incoming history update without treating absent/empty signatures as deletion. */
export function mergeHistoryData(
  previous: HistoryData | null | undefined,
  incoming: HistoryData,
): HistoryData {
  const merged: HistoryData = { ...(previous ?? {}), ...incoming };
  const incomingSignature = incoming.customerSignatureImage;

  if (
    incomingSignature === undefined ||
    incomingSignature === null ||
    incomingSignature === ""
  ) {
    if (previous && Object.hasOwn(previous, "customerSignatureImage")) {
      merged.customerSignatureImage = previous.customerSignatureImage;
    } else {
      delete merged.customerSignatureImage;
    }
  }

  return merged;
}
