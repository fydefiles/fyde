import React from "react";
import { ScrollView, Text, View } from "react-native";
import { Link } from "expo-router";
import { styles } from "./ui";
import help from "../../../content/help.json";
import plans from "../../../content/plans.json";

export function Help() {
  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.eyebrow}>HELP WITH FYDE</Text>
      <Text style={styles.heading}>Share with intention.</Text>
      {help.sections.map((section) => (
        <View style={styles.card} key={section.id}>
          <Text style={styles.cardTitle}>{section.title}</Text>
          <Text style={styles.sub}>{section.body}</Text>
        </View>
      ))}
      <Text style={styles.fine}>
        Fyde inbox delivery is connected. Email and SMS file notifications are
        not connected in this development app.
      </Text>
      <Link href="/feedback" style={styles.fine}>
        Send feedback or a private support request →
      </Link>
      <Link href="/privacy" style={styles.fine}>
        Privacy and resource policies →
      </Link>
      <Link href="/" style={styles.fine}>
        Back to Fyde →
      </Link>
    </ScrollView>
  );
}
export function Privacy() {
  const sections = [
    [
      "What Fyde stores",
      "Fyde stores uploaded originals, extracted text, document metadata, contacts, case assignments, relationship labels, permissions, private chat history, transfer and received-file records, and hashed device or agent credentials. Managed authentication stores your sign-in identity and sessions. Fyde does not provide end-to-end encryption.",
    ],
    [
      "Sharing and personal agents",
      "Delivery and downloads check the owner, verified recipient, exact version, permission, expiry and pause controls. Relationship labels help find contacts and grant no access. Case permissions can include selected types, future files, future versions or sensitive files only when you enable that scope. A recipient agent credential covers one received case permission. Revoking a transfer stops its future downloads; an independently active case permission can still release matching files. Downloaded copies cannot be recalled.",
    ],
    [
      "Chat and company agents",
      "Chat stays in your customer workspace. Recent choices can provide 15-minute context; you can turn this off in Account. The current assistant uses bounded commands and sends no document contents to an external language model. Company development and marketing agents are separate from your file assistant and cannot access this chat or your documents.",
    ],
    [
      "Retention, export and deletion",
      "Original export remains available after subscription cancellation. Export account metadata from Account. Document deletion requires a recent sign-in and your email confirmation; it immediately hides all versions, clears searchable text and revokes sharing. Original removal retries if storage is unavailable. Minimal audit and usage records remain. Complete account deletion and backup erasure need an operator policy. These working policies require review before a public paid launch.",
    ],
    [
      "Feedback",
      "Private support stays in the customer workspace. Public feedback requires explicit consent and review before publication. Exclude passwords, document text and other private information. You can withdraw feedback in the feedback page. Automated redaction can miss information.",
    ],
    ["Resource limits", plans.resource_policy],
  ];
  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.eyebrow}>PRIVACY AND CONTROLS</Text>
      <Text style={styles.heading}>Know where your files go.</Text>
      {sections.map(([title, body]) => (
        <View style={styles.card} key={title}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.sub}>{body}</Text>
        </View>
      ))}
      <Link href="/feedback" style={styles.fine}>
        Private support →
      </Link>
      <Link href="/" style={styles.fine}>
        Back to Fyde →
      </Link>
    </ScrollView>
  );
}
export function Pricing() {
  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.eyebrow}>PRICING EXPERIMENT</Text>
      <Text style={styles.heading}>A plan for your files.</Text>
      {Object.entries(plans.plans).map(([id, plan]) => (
        <View style={styles.card} key={id}>
          <Text style={styles.cardTitle}>
            {plan.name} · ${plan.monthly_usd}/month
          </Text>
          <Text style={styles.sub}>
            {plan.sends === null
              ? "Unlimited file sends"
              : `${plan.sends} file sends per month`}
            {"\n"}
            {plan.storage_mib} MiB storage · {plan.file_mib} MiB per file
          </Text>
        </View>
      ))}
      <Text style={styles.fine}>
        These prices are an experiment. Paid checkout is not connected in this
        development app. Everyone starts on Free.
      </Text>
      <Text style={styles.fine}>{plans.resource_policy}</Text>
      <Link href="/" style={styles.fine}>
        Back to Fyde →
      </Link>
    </ScrollView>
  );
}
