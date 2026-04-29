import type {
  CustomerOperatingProfileDailyRecord,
  CustomerOperatingSignalRecord,
  CustomerSegmentRecord,
  MemberCurrentRecord,
  MemberReactivationFeatureRecord,
} from "../types.js";

function resolveMemberIdFromIdentityKey(customerIdentityKey: string): string | undefined {
  return customerIdentityKey.startsWith("member:")
    ? customerIdentityKey.slice("member:".length)
    : undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getSignal(
  signals: CustomerOperatingSignalRecord[],
  signalDomain: string,
  signalKey: string,
): CustomerOperatingSignalRecord | undefined {
  return signals.find(
    (signal) => signal.signalDomain === signalDomain && signal.signalKey === signalKey,
  );
}

function sortSignalIds(signals: CustomerOperatingSignalRecord[]): string[] {
  return [...signals.map((signal) => signal.signalId)].sort((left, right) =>
    left.localeCompare(right),
  );
}

function isActiveSignal(signal: CustomerOperatingSignalRecord, bizDate: string): boolean {
  return !signal.validTo || signal.validTo >= bizDate;
}

export function buildCustomerOperatingProfilesDaily(params: {
  orgId: string;
  bizDate: string;
  updatedAt: string;
  currentMembers: MemberCurrentRecord[];
  customerSegments: CustomerSegmentRecord[];
  reactivationFeatures: MemberReactivationFeatureRecord[];
  operatingSignals: CustomerOperatingSignalRecord[];
}): CustomerOperatingProfileDailyRecord[] {
  const membersById = new Map(params.currentMembers.map((member) => [member.memberId, member]));
  const segmentsByIdentity = new Map(
    params.customerSegments.map((segment) => [segment.customerIdentityKey, segment]),
  );
  const featuresByIdentity = new Map(
    params.reactivationFeatures.map((feature) => [feature.customerIdentityKey, feature]),
  );
  const signalsByIdentity = new Map<string, CustomerOperatingSignalRecord[]>();
  for (const signal of params.operatingSignals) {
    if (!isActiveSignal(signal, params.bizDate)) {
      continue;
    }
    const current = signalsByIdentity.get(signal.customerIdentityKey) ?? [];
    current.push(signal);
    signalsByIdentity.set(signal.customerIdentityKey, current);
  }

  const identityKeys = new Set<string>([
    ...segmentsByIdentity.keys(),
    ...featuresByIdentity.keys(),
    ...signalsByIdentity.keys(),
  ]);

  const rows: CustomerOperatingProfileDailyRecord[] = [];

  for (const customerIdentityKey of Array.from(identityKeys).sort((left, right) => left.localeCompare(right))) {
    const segment = segmentsByIdentity.get(customerIdentityKey);
    const feature = featuresByIdentity.get(customerIdentityKey);
    const signals = signalsByIdentity.get(customerIdentityKey) ?? [];
    const memberId = segment?.memberId ?? feature?.memberId ?? resolveMemberIdFromIdentityKey(customerIdentityKey);
    const member = memberId ? membersById.get(memberId) : undefined;
    const customerDisplayName =
      segment?.customerDisplayName ??
      feature?.customerDisplayName ??
      member?.name ??
      customerIdentityKey;

    const primaryNeedSignal = getSignal(signals, "service_need", "primary_need");
    const communicationStyleSignal = getSignal(signals, "interaction_style", "communication_style");
    const preferredDaypartSignal = getSignal(signals, "time_preference", "preferred_daypart");
    const preferredTechSignal = getSignal(signals, "tech_preference", "preferred_tech_code");
    const preferredChannelSignal = getSignal(signals, "contact_preference", "preferred_channel");
    const preferredTechMeta = asObject(preferredTechSignal?.valueJson);
    const preferredChannelMeta = asObject(preferredChannelSignal?.valueJson);
    const communicationMeta = asObject(communicationStyleSignal?.valueJson);
    const serviceNeedMeta = asObject(primaryNeedSignal?.valueJson);

    rows.push({
      orgId: params.orgId,
      bizDate: params.bizDate,
      memberId,
      customerIdentityKey,
      customerDisplayName,
      identityProfileJson: {
        member_id: memberId,
        member_name: member?.name ?? customerDisplayName,
        phone: member?.phone,
        member_card_no: segment?.memberCardNo ?? feature?.memberCardNo,
        reference_code: segment?.referenceCode ?? feature?.referenceCode,
        member_label: segment?.memberLabel,
        identity_stable: segment?.identityStable ?? true,
        created_time: member?.createdTime,
        current_silent_days: member?.silentDays,
      },
      spendingProfileJson: {
        primary_segment: segment?.primarySegment ?? feature?.primarySegment,
        recency_segment: segment?.recencySegment,
        monetary_segment: segment?.monetarySegment,
        payment_segment: segment?.paymentSegment,
        pay_amount_30d: segment?.payAmount30d ?? feature?.payAmount30d ?? 0,
        pay_amount_90d: segment?.payAmount90d ?? feature?.payAmount90d ?? 0,
        current_stored_amount: member?.storedAmount ?? 0,
        current_consume_amount: member?.consumeAmount ?? 0,
        current_stored_balance_inferred: feature?.currentStoredBalanceInferred,
        projected_balance_days_left: feature?.projectedBalanceDaysLeft,
      },
      serviceNeedProfileJson: {
        primary_need: primaryNeedSignal?.valueText,
        signal_confidence: primaryNeedSignal?.confidence,
        truth_boundary: primaryNeedSignal?.truthBoundary,
        confidence_discount: serviceNeedMeta.confidence_discount,
      },
      interactionProfileJson: {
        communication_style: communicationStyleSignal?.valueText,
        signal_confidence: communicationStyleSignal?.confidence,
        confidence_discount: communicationMeta.confidence_discount,
      },
      preferenceProfileJson: {
        preferred_daypart: preferredDaypartSignal?.valueText ?? feature?.dominantVisitDaypart,
        preferred_channel: preferredChannelSignal?.valueText,
        preferred_channel_confidence: preferredChannelSignal?.confidence,
        preferred_channel_truth_boundary: preferredChannelSignal?.truthBoundary,
        preferred_channel_confidence_discount: preferredChannelMeta.confidence_discount,
        preferred_tech_code: preferredTechSignal?.valueText ?? segment?.topTechCode,
        preferred_tech_name:
          (preferredTechMeta.techName as string | undefined) ?? segment?.topTechName,
      },
      scenarioProfileJson: {
        dominant_visit_daypart: feature?.dominantVisitDaypart,
        dominant_visit_weekday: feature?.dominantVisitWeekday,
        dominant_visit_month_phase: feature?.dominantVisitMonthPhase,
        preferred_daypart_share_90d: feature?.preferredDaypartShare90d,
        preferred_weekday_share_90d: feature?.preferredWeekdayShare90d,
        weekend_visit_share_90d: feature?.weekendVisitShare90d,
        late_night_visit_share_90d: feature?.lateNightVisitShare90d,
      },
      relationshipProfileJson: {
        top_tech_code: segment?.topTechCode,
        top_tech_name: segment?.topTechName,
        top_tech_visit_share_90d: segment?.topTechVisitShare90d,
        tech_loyalty_segment: segment?.techLoyaltySegment,
        distinct_tech_count_90d: segment?.distinctTechCount90d,
      },
      opportunityProfileJson: {
        primary_segment: segment?.primarySegment ?? feature?.primarySegment,
        days_since_last_visit: feature?.daysSinceLastVisit ?? segment?.daysSinceLastVisit,
        reactivation_priority_score: feature?.reactivationPriorityScore,
        cycle_deviation_score: feature?.cycleDeviationScore,
        time_preference_confidence_score: feature?.timePreferenceConfidenceScore,
        trajectory_confidence_score: feature?.trajectoryConfidenceScore,
        current_stored_balance_inferred: feature?.currentStoredBalanceInferred,
        projected_balance_days_left: feature?.projectedBalanceDaysLeft,
      },
      sourceSignalIds: sortSignalIds(signals),
      updatedAt: params.updatedAt,
    });
  }

  return rows;
}
