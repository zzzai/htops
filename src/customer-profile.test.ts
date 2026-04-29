import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { lookupStructuredCustomerProfile } from "./customer-profile.js";

function buildConfig(overrides: Record<string, unknown> = {}) {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      {
        orgId: "1001",
        storeName: "迎宾店",
        rawAliases: ["迎宾"],
      },
    ],
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lookupStructuredCustomerProfile", () => {
  it("builds a structured payload for tool-facing customer profile lookup", async () => {
    const config = buildConfig();

    const result = await lookupStructuredCustomerProfile({
      runtime: {
        findCurrentMembersByPhoneSuffix: async () =>
          [
            {
              orgId: "1001",
              memberId: "M001",
              name: "张女士",
              phone: "13800008888",
              storedAmount: 780,
              consumeAmount: 2680,
              lastConsumeTime: "2026-04-10 20:15:00",
              silentDays: 0,
              rawJson: "{}",
            },
          ] as never,
        listCustomerProfile90dByDateRange: async () =>
          [
            {
              orgId: "1001",
              windowEndBizDate: "2026-04-10",
              customerDisplayName: "张女士",
              memberId: "M001",
              primarySegment: "important-reactivation-member",
              recencySegment: "active-30d",
              frequencySegment: "medium-2-3",
              monetarySegment: "high-1000-plus",
              paymentSegment: "mixed-member-nonmember",
              techLoyaltySegment: "single-tech-loyal",
              payAmount90d: 2680,
              visitCount90d: 6,
              currentStoredAmount: 780,
              currentSilentDays: 0,
              topTechName: "王技师",
              tagKeys: ["important-reactivation-member"],
            },
          ] as never,
      },
      config,
      orgId: "1001",
      bizDate: "2026-04-10",
      phoneSuffix: "8888",
      now: new Date("2026-04-10T20:00:00+08:00"),
    });

    expect(result).toMatchObject({
      org_id: "1001",
      store_name: "迎宾店",
      snapshot_biz_date: "2026-04-10",
      matched_members: [
        {
          member_id: "M001",
          customer_name: "张女士",
          phone_suffix: "8888",
          current_member_state: {
            stored_amount: 780,
            consume_amount: 2680,
            silent_days: 0,
          },
          current_profile: {
            primary_segment: "important-reactivation-member",
            top_tech_name: "王技师",
          },
        },
      ],
    });
    expect(result?.legacy_profile_text).toBeUndefined();
  });

  it("adds bounded ai advisory without changing deterministic profile facts", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    profileNarrative: "这位顾客近90天消费稳定，近期适合晚间柔性关怀。",
                    highValueSignals: ["近90天消费稳定", "有熟悉技师偏好"],
                    riskSignals: ["如果继续沉默，熟客关系可能走弱"],
                    missingFacts: ["是否愿意接受工作日晚间邀约"],
                  }),
                },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    softTags: ["晚间偏好", "熟技师偏好"],
                    tagHypotheses: ["适合围绕熟悉技师做回访"],
                    tagReasons: ["最近一次消费和90天主技师偏好都指向固定服务关系"],
                  }),
                },
              },
            ],
          }),
        }),
    );

    const config = buildConfig({
      customerGrowthAi: {
        enabled: true,
        baseUrl: "https://customer-growth.example.com/v1",
        apiKey: "growth-secret",
        model: "gpt-5-mini",
        timeoutMs: 3200,
        profileInsight: { enabled: true },
        tagAdvisor: { enabled: true },
        strategyAdvisor: { enabled: false },
        followupSummarizer: { enabled: false },
      },
    });

    const result = await lookupStructuredCustomerProfile({
      runtime: {
        findCurrentMembersByPhoneSuffix: async () =>
          [
            {
              orgId: "1001",
              memberId: "M001",
              name: "张女士",
              phone: "13800008888",
              storedAmount: 780,
              consumeAmount: 2680,
              lastConsumeTime: "2026-04-10 20:15:00",
              silentDays: 0,
              birthday: "1992-04-15",
              rawJson: "{}",
            },
          ] as never,
        listCustomerProfile90dByDateRange: async () =>
          [
            {
              orgId: "1001",
              windowEndBizDate: "2026-04-10",
              customerDisplayName: "张女士",
              memberId: "M001",
              primarySegment: "important-reactivation-member",
              recencySegment: "active-30d",
              frequencySegment: "medium-2-3",
              monetarySegment: "high-1000-plus",
              paymentSegment: "mixed-member-nonmember",
              techLoyaltySegment: "single-tech-loyal",
              payAmount90d: 2680,
              visitCount90d: 6,
              currentStoredAmount: 780,
              currentSilentDays: 0,
              topTechName: "王技师",
              tagKeys: ["important-reactivation-member"],
            },
          ] as never,
      },
      config,
      orgId: "1001",
      bizDate: "2026-04-10",
      phoneSuffix: "8888",
      now: new Date("2026-04-10T20:00:00+08:00"),
    });

    expect(result?.matched_members[0]).toMatchObject({
      member_id: "M001",
      current_profile: {
        primary_segment: "important-reactivation-member",
        pay_amount_90d: 2680,
      },
      ai_advisory: {
        profile_insight: {
          profile_narrative: "这位顾客近90天消费稳定，近期适合晚间柔性关怀。",
          high_value_signals: ["近90天消费稳定", "有熟悉技师偏好"],
          risk_signals: ["如果继续沉默，熟客关系可能走弱"],
          missing_facts: ["是否愿意接受工作日晚间邀约"],
        },
        tag_advisor: {
          soft_tags: ["晚间偏好", "熟技师偏好"],
          tag_hypotheses: ["适合围绕熟悉技师做回访"],
          tag_reasons: ["最近一次消费和90天主技师偏好都指向固定服务关系"],
        },
      },
    });
    expect(result?.matched_members[0]?.current_profile?.primary_segment).toBe(
      "important-reactivation-member",
    );
  });

  it("exposes operating profile snapshot and evidence boundaries without leaking raw observation notes", async () => {
    const config = buildConfig();

    const result = await lookupStructuredCustomerProfile({
      runtime: {
        findCurrentMembersByPhoneSuffix: async () =>
          [
            {
              orgId: "1001",
              memberId: "M001",
              name: "张女士",
              phone: "13800008888",
              storedAmount: 1280,
              consumeAmount: 3680,
              lastConsumeTime: "2026-04-10 20:15:00",
              silentDays: 3,
              rawJson: "{}",
            },
          ] as never,
        listCustomerProfile90dByDateRange: async () =>
          [
            {
              orgId: "1001",
              windowEndBizDate: "2026-04-10",
              customerDisplayName: "张女士",
              memberId: "M001",
              primarySegment: "important-reactivation-member",
              recencySegment: "active-30d",
              frequencySegment: "medium-2-3",
              monetarySegment: "high-1000-plus",
              paymentSegment: "mixed-member-nonmember",
              techLoyaltySegment: "single-tech-loyal",
              payAmount90d: 3680,
              visitCount90d: 6,
              currentStoredAmount: 1280,
              currentSilentDays: 3,
              topTechName: "王技师",
              tagKeys: ["important-reactivation-member"],
            },
          ] as never,
        listCustomerOperatingProfilesDaily: async () =>
          [
            {
              orgId: "1001",
              bizDate: "2026-04-10",
              memberId: "M001",
              customerIdentityKey: "member:M001",
              customerDisplayName: "张女士",
              identityProfileJson: {
                member_name: "张女士",
                phone: "13800008888",
                identity_stable: true,
              },
              spendingProfileJson: {
                primary_segment: "important-reactivation-member",
                pay_amount_90d: 3680,
                current_stored_amount: 1280,
              },
              serviceNeedProfileJson: {
                primary_need: "肩颈放松",
                signal_confidence: "high",
              },
              interactionProfileJson: {
                communication_style: "少聊天",
                confidence_discount: 0.35,
              },
              preferenceProfileJson: {
                preferred_daypart: "夜场",
                preferred_tech_name: "王技师",
              },
              scenarioProfileJson: {
                dominant_visit_daypart: "night",
                dominant_visit_weekday: "friday",
              },
              relationshipProfileJson: {
                top_tech_name: "王技师",
                tech_loyalty_segment: "single-tech-loyal",
              },
              opportunityProfileJson: {
                reactivation_priority_score: 612,
                cycle_deviation_score: 0.68,
              },
              sourceSignalIds: ["signal-1", "signal-2", "signal-3"],
              updatedAt: "2026-04-10T20:00:00.000Z",
            },
          ] as never,
        listCustomerOperatingSignals: async () =>
          [
            {
              signalId: "signal-1",
              orgId: "1001",
              memberId: "M001",
              customerIdentityKey: "member:M001",
              signalDomain: "service_need",
              signalKey: "primary_need",
              valueText: "肩颈放松",
              valueJson: { confidence_discount: 0 },
              confidence: "high",
              truthBoundary: "hard_fact",
              scoringScope: "profile_allowed",
              sourceObservationIds: ["obs-1", "obs-2"],
              supportCount: 2,
              observedAt: "2026-04-10T18:00:00.000Z",
              updatedAt: "2026-04-10T20:00:00.000Z",
            },
            {
              signalId: "signal-2",
              orgId: "1001",
              memberId: "M001",
              customerIdentityKey: "member:M001",
              signalDomain: "interaction_style",
              signalKey: "communication_style",
              valueText: "少聊天",
              valueJson: { confidence_discount: 0.35 },
              confidence: "medium",
              truthBoundary: "observed_fact",
              scoringScope: "action_only",
              sourceObservationIds: ["obs-3"],
              supportCount: 1,
              observedAt: "2026-04-10T18:10:00.000Z",
              updatedAt: "2026-04-10T20:00:00.000Z",
            },
            {
              signalId: "signal-3",
              orgId: "1001",
              memberId: "M001",
              customerIdentityKey: "member:M001",
              signalDomain: "contact_preference",
              signalKey: "preferred_channel",
              valueText: "企微",
              valueJson: { confidence_discount: 0.65 },
              confidence: "low",
              truthBoundary: "predicted_signal",
              scoringScope: "action_only",
              sourceObservationIds: ["obs-4"],
              supportCount: 1,
              observedAt: "2026-04-10T18:20:00.000Z",
              updatedAt: "2026-04-10T20:00:00.000Z",
            },
          ] as never,
        listCustomerServiceObservations: async () =>
          [
            {
              observationId: "obs-1",
              orgId: "1001",
              memberId: "M001",
              customerIdentityKey: "member:M001",
              sourceRole: "technician",
              sourceType: "self_reported",
              signalDomain: "service_need",
              signalKey: "primary_need",
              valueText: "肩颈放松",
              confidence: "high",
              truthBoundary: "hard_fact",
              observedAt: "2026-04-10T18:00:00.000Z",
              rawNote: "客户明确说最近肩颈很紧",
              rawJson: "{}",
              updatedAt: "2026-04-10T20:00:00.000Z",
            },
            {
              observationId: "obs-2",
              orgId: "1001",
              memberId: "M001",
              customerIdentityKey: "member:M001",
              sourceRole: "technician",
              sourceType: "staff_observed",
              signalDomain: "service_need",
              signalKey: "primary_need",
              valueText: "肩颈放松",
              confidence: "medium",
              truthBoundary: "observed_fact",
              observedAt: "2026-04-10T18:01:00.000Z",
              rawNote: "按肩颈时明显紧张",
              rawJson: "{}",
              updatedAt: "2026-04-10T20:00:00.000Z",
            },
            {
              observationId: "obs-3",
              orgId: "1001",
              memberId: "M001",
              customerIdentityKey: "member:M001",
              sourceRole: "technician",
              sourceType: "staff_observed",
              signalDomain: "interaction_style",
              signalKey: "communication_style",
              valueText: "少聊天",
              confidence: "medium",
              truthBoundary: "observed_fact",
              observedAt: "2026-04-10T18:10:00.000Z",
              rawNote: "服务过程中更喜欢安静",
              rawJson: "{}",
              updatedAt: "2026-04-10T20:00:00.000Z",
            },
            {
              observationId: "obs-4",
              orgId: "1001",
              memberId: "M001",
              customerIdentityKey: "member:M001",
              sourceRole: "system",
              sourceType: "system_inferred",
              signalDomain: "contact_preference",
              signalKey: "preferred_channel",
              valueText: "企微",
              confidence: "low",
              truthBoundary: "predicted_signal",
              observedAt: "2026-04-10T18:20:00.000Z",
              rawNote: "系统推测更适合企微触达",
              rawJson: "{}",
              updatedAt: "2026-04-10T20:00:00.000Z",
            },
          ] as never,
      },
      config,
      orgId: "1001",
      bizDate: "2026-04-10",
      phoneSuffix: "8888",
      now: new Date("2026-04-10T20:00:00+08:00"),
    });

    expect(result?.matched_members[0]).toMatchObject({
      member_id: "M001",
      operating_profile: {
        service_need_profile: {
          primary_need: "肩颈放松",
          signal_confidence: "high",
        },
        interaction_profile: {
          communication_style: "少聊天",
        },
        opportunity_profile: {
          reactivation_priority_score: 612,
        },
      },
      evidence_summary: {
        facts: expect.arrayContaining([
          expect.objectContaining({
            signal_key: "primary_need",
            truth_boundary: "hard_fact",
            display_text: "服务诉求：肩颈放松",
            source_summary: expect.arrayContaining(["顾客自述", "技师观察"]),
          }),
        ]),
        observations: expect.arrayContaining([
          expect.objectContaining({
            signal_key: "communication_style",
            truth_boundary: "observed_fact",
            display_text: "互动风格：观察偏向少聊天",
          }),
        ]),
        inferences: expect.arrayContaining([
          expect.objectContaining({
            signal_key: "preferred_channel",
            truth_boundary: "predicted_signal",
            display_text: "触达偏好：可能更接受企微",
          }),
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toContain("客户明确说最近肩颈很紧");
  });
});
