"use server";

import Stripe from "stripe";
import { db } from "../db";
import { stripe } from ".";
import { Plan } from "@prisma/client";

type PeriodItem = { price?: { id?: string } | null };
type PeriodField = 'current_period_start' | 'current_period_end';
type PlanItem = (items: PeriodItem[]) => PeriodItem | undefined;

// Typed like the removed field, which was also absent at runtime when Stripe omitted it.
function subscriptionPeriod(subscription: object, field: PeriodField, planItem?: PlanItem): number {
  const legacy: unknown = Reflect.get(subscription, field);
  if (typeof legacy === 'number') return legacy;
  const list: unknown = Reflect.get(subscription, 'items');
  const data: unknown = list && typeof list === 'object' ? Reflect.get(list, 'data') : undefined;
  const items = (Array.isArray(data) ? data : []).filter(
    (item): item is PeriodItem => typeof item === 'object' && item !== null,
  );
  const periods = new Set(items.map((item) => Reflect.get(item, field)));
  const chosen = periods.size === 1 ? items[0] : planItem?.(items);
  const value: unknown = chosen ? Reflect.get(chosen, field) : undefined;
  return (typeof value === 'number' ? value : undefined) as number;
}

function getSubscriptionPeriodEnd(subscription: object, planItem?: PlanItem): number {
  return subscriptionPeriod(subscription, 'current_period_end', planItem);
}

export const subscriptionCreated = async (subscription: Stripe.Subscription, customerId: string) => {
    try {
        const agency = await db.agency.findFirst({
            where: {
                customerId,
            },
            include: {
                Subscription: true,
            },
        });

        if (!agency) {
            throw new Error("Could not find and agency to upsert the subscription");
        }

        const data = {
            active: subscription.status === "active",
            agencyId: agency.id,
            customerId,
            currentPeriodEndDate: new Date((getSubscriptionPeriodEnd(subscription)) * 1000),
            //@ts-ignore
            priceId: subscription.plan.id,
            subscritiptionId: subscription.id,
            //@ts-ignore
            plan: subscription.plan.id as keyof typeof Plan,
        };

        console.log({ ...subscription });

        const res = await db.subscription.upsert({
            where: {
                agencyId: agency.id,
            },
            create: data,
            update: data,
        });

        console.log(`🟢 Created Subscription for ${subscription.id}`);
    } catch (error) {
        console.log("🔴 Error from Create action", error);
    }
};

export const getConnectAccountProducts = async (stripeAccount: string) => {
    const products = await stripe.products.list(
        {
            limit: 50,
            expand: ["data.default_price"],
        },
        {
            stripeAccount,
        }
    );
    return products.data;
};
