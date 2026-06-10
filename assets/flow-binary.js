export function decodeFlowBinary(buffer, provinces = []) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== "EIF1") throw new Error("bad flow binary magic");
  const headerLength = view.getUint32(4, true);
  const headerBytes = new Uint8Array(buffer, 8, headerLength);
  const header = JSON.parse(new TextDecoder().decode(headerBytes));
  let offset = 8 + headerLength;
  const rows = [];
  const hasProvince = !!header.province;
  const provinceNames = header.provinces || provinces;
  for (let i = 0; i < header.row_count; i++) {
    let il = "";
    if (hasProvince) {
      il = provinceNames[view.getUint16(offset, true)];
      offset += 2;
    }
    const source = header.source_parties[view.getUint16(offset, true)];
    const target = header.target_parties[view.getUint16(offset + 2, true)];
    offset += 4;
    const sourceVotes = view.getFloat64(offset, true); offset += 8;
    const sourceObservedVotes = view.getFloat64(offset, true); offset += 8;
    const targetVotes = view.getFloat64(offset, true); offset += 8;
    const flow = view.getFloat64(offset, true); offset += 8;
    const probability = view.getFloat64(offset, true); offset += 8;
    const targetShare = view.getFloat64(offset, true); offset += 8;
    rows.push({
      ...(hasProvince ? {il} : {}),
      pair_key: header.pair_key,
      source_key: header.source_key,
      target_key: header.target_key,
      model: header.model,
      source_party: source,
      target_party: target,
      source_votes: sourceVotes,
      source_observed_votes: sourceObservedVotes,
      target_votes: targetVotes,
      estimated_flow_votes: flow,
      transition_probability: probability,
      source_share_of_row: probability,
      target_share_of_column: targetShare,
      source_node_id: `${header.source_key}::${source}`,
      target_node_id: `${header.target_key}::${target}`,
      direction: header.direction || "directed",
    });
  }
  return rows;
}

export function decodeIlceVoteBinary(buffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== "EIV1") throw new Error("bad ilce vote binary magic");
  const headerLength = view.getUint32(4, true);
  const headerBytes = new Uint8Array(buffer, 8, headerLength);
  const header = JSON.parse(new TextDecoder().decode(headerBytes));
  let offset = 8 + headerLength;
  const sourceCount = header.source_parties.length;
  const targetCount = header.target_parties.length;
  const rows = [];
  for (let i = 0; i < header.row_count; i++) {
    const district = header.districts[view.getUint16(offset, true)];
    offset += 2;
    const sourceTotal = view.getFloat32(offset, true); offset += 4;
    const targetTotal = view.getFloat32(offset, true); offset += 4;
    const sourceVotes = {};
    for (let s = 0; s < sourceCount; s++) {
      sourceVotes[header.source_parties[s]] = view.getFloat32(offset, true);
      offset += 4;
    }
    const targetVotes = {};
    for (let t = 0; t < targetCount; t++) {
      targetVotes[header.target_parties[t]] = view.getFloat32(offset, true);
      offset += 4;
    }
    rows.push({
      il: district.il,
      ilce: district.ilce,
      source_total: sourceTotal,
      target_total: targetTotal,
      source_votes: sourceVotes,
      target_votes: targetVotes,
    });
  }
  return {
    sourceParties: header.source_parties,
    targetParties: header.target_parties,
    rows,
  };
}

export function decodePairErrorsBinary(buffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== "EIE1") throw new Error("bad pair error binary magic");
  const headerLength = view.getUint32(4, true);
  const headerBytes = new Uint8Array(buffer, 8, headerLength);
  const header = JSON.parse(new TextDecoder().decode(headerBytes));
  let offset = 8 + headerLength;
  const out = {};
  for (let i = 0; i < header.row_count; i++) {
    const pairKey = header.pairs[view.getUint16(offset, true)];
    offset += 2;
    out[pairKey] = {};
    for (const model of header.models) {
      const l1 = view.getFloat64(offset, true); offset += 8;
      const halfL1 = view.getFloat64(offset, true); offset += 8;
      const absError = view.getFloat64(offset, true); offset += 8;
      const votes = view.getFloat64(offset, true); offset += 8;
      out[pairKey][model] = {
        l1_per_1000: l1,
        half_l1_per_1000: halfL1,
        mae_per_1000: l1,
        abs_error: absError,
        votes,
      };
    }
  }
  return out;
}
