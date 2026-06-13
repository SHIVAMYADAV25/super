import { getTenant } from "@/src/server/lib/corsair";

export async function GET() {
  const tenant = getTenant("test");

  console.log("gmail.keys", Object.keys(tenant.gmail.keys));
  console.log("calendar.keys", Object.keys(tenant.googlecalendar.keys));

  return Response.json({
    gmailKeys: Object.keys(tenant.gmail.keys),
    calendarKeys: Object.keys(tenant.googlecalendar.keys),
  });
}