import { atmn, feature, plan } from "atmn";

export default atmn({
  features: [feature({
    internalId: "fe_3JY0YuagHNTmVmJE9LZYjGWnMZJ",
    featureId: "classifier_pro_limits",
    name: "10× classification rate limits",
    type: "boolean",
  })],
  plans: [plan({
    internalId: "prod_3JY0YnGHp7SRlaypoKnlwzJH4jE",
    planId: "pro",
    versionSlug: "v1",
    active: true,
    name: "Pro",
    price: { amount: 20, interval: "month" },
    items: [{ featureId: "classifier_pro_limits" }],
  })],
});
