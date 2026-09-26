import { atmn, feature, plan } from "atmn";

// Credits are Autumn's purchase unit for pay-as-you-go top-ups: 100,000 credits
// equal one dollar (src/lib/billing.ts). The wallet itself stays in Neon; a
// purchase only becomes spendable after its paid invoice is verified.
export default atmn({
  features: [feature({
    internalId: "fe_3JY0YuagHNTmVmJE9LZYjGWnMZJ",
    featureId: "classifier_pro_limits",
    name: "10× classification rate limits",
    type: "boolean",
  }), feature({
    internalId: "fe_3JrMqs92gvWniLPaJPhqiVuPA8X",
    featureId: "classifier_scale_limits",
    name: "100× classification rate limits",
    type: "boolean",
  }), feature({
    internalId: "fe_3JrMqrgKPokKsoXINHblHh1ohYW",
    featureId: "credits",
    name: "Usage credits",
    type: "metered",
    consumable: true,
  })],
  plans: [plan({
    internalId: "prod_3JY06U2NCtuwTdTAEkMlOlt79yA",
    planId: "pro",
    versionSlug: "v1",
    active: true,
    name: "Pro",
    price: { amount: 20, interval: "month" },
    items: [{ featureId: "classifier_pro_limits" }],
  }), plan({
    internalId: "prod_3JrMqrNNqVvXC9wemjHgPNaoQR5",
    planId: "scale",
    versionSlug: "v1",
    active: true,
    name: "Scale",
    price: { amount: 200, interval: "month" },
    items: [{ featureId: "classifier_scale_limits" }],
  }), plan({
    internalId: "prod_3JrMquITKMqYfKzHnUTWZXiRUgA",
    planId: "top_up",
    versionSlug: "v1",
    active: true,
    addOn: true,
    name: "Credit top-up",
    items: [{
      featureId: "credits",
      price: {
        amount: 1,
        billingUnits: 100_000,
        billingMethod: "prepaid",
        interval: "one_off",
      },
    }],
  })],
});
