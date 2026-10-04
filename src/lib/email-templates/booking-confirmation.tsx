import * as React from "react";

import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { TemplateEntry } from "./registry";

interface BookingConfirmationProps {
  slotName?: string;
  area?: string;
  fullAddress?: string;
  accessInstructions?: string;
  startTime?: string;
  endTime?: string;
  vehiclePlate?: string;
  total?: string;
}

const BookingConfirmationEmail = ({
  slotName = "Your parking space",
  area,
  fullAddress,
  accessInstructions,
  startTime,
  endTime,
  vehiclePlate,
  total,
}: BookingConfirmationProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your Usop parking booking is confirmed</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>USOP</Text>
        <Heading style={h1}>Booking confirmed</Heading>
        <Text style={text}>
          Your space at <strong>{slotName}</strong>
          {area ? ` (${area})` : ""} is reserved.
        </Text>

        <Section style={card}>
          {startTime ? <Text style={row}>From: {startTime}</Text> : null}
          {endTime ? <Text style={row}>Until: {endTime}</Text> : null}
          {vehiclePlate ? <Text style={row}>Vehicle: {vehiclePlate}</Text> : null}
          {total ? <Text style={rowStrong}>Total: {total}</Text> : null}
        </Section>

        {fullAddress ? (
          <>
            <Hr style={hr} />
            <Text style={label}>Address</Text>
            <Text style={text}>{fullAddress}</Text>
          </>
        ) : null}

        {accessInstructions ? (
          <>
            <Text style={label}>Access instructions</Text>
            <Text style={text}>{accessInstructions}</Text>
          </>
        ) : null}

        <Text style={footer}>
          Need help? Reply to this email or visit the Help section in the Usop app.
        </Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: BookingConfirmationEmail,
  subject: "Your Usop booking is confirmed",
  displayName: "Booking confirmation",
  previewData: {
    slotName: "Anna Nagar Covered Bay",
    area: "Anna Nagar West, Chennai",
    fullAddress: "12, 3rd Avenue, Anna Nagar West, Chennai 600040",
    accessInstructions: "Gate code 4821. Bay #7 on the left.",
    startTime: "29 Jul 2026, 9:00 AM",
    endTime: "29 Jul 2026, 1:00 PM",
    vehiclePlate: "TN01AB1234",
    total: "₹465.00",
  },
} satisfies TemplateEntry;

export default BookingConfirmationEmail;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "24px 25px", maxWidth: "560px" };
const brand = {
  fontSize: "13px",
  letterSpacing: "2px",
  fontWeight: "bold" as const,
  color: "#443A78",
  margin: "0 0 12px",
};
const h1 = {
  fontSize: "22px",
  fontWeight: "bold" as const,
  color: "#2A2438",
  margin: "0 0 16px",
};
const text = {
  fontSize: "14px",
  color: "#55575d",
  lineHeight: "1.6",
  margin: "0 0 16px",
};
const card = {
  backgroundColor: "#FAF6EF",
  borderRadius: "10px",
  padding: "16px 18px",
  margin: "0 0 8px",
};
const row = { fontSize: "14px", color: "#2A2438", margin: "0 0 6px" };
const rowStrong = {
  fontSize: "15px",
  color: "#443A78",
  fontWeight: "bold" as const,
  margin: "8px 0 0",
};
const label = {
  fontSize: "12px",
  textTransform: "uppercase" as const,
  letterSpacing: "1px",
  color: "#F2A522",
  fontWeight: "bold" as const,
  margin: "16px 0 6px",
};
const hr = { borderColor: "#eeeae3", margin: "20px 0" };
const footer = { fontSize: "12px", color: "#999999", margin: "28px 0 0" };
