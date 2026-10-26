-- Custom branded payment receipt template (#572).
--
-- Stores the normalized branding subset (brandName, logoUrl, primaryColor,
-- accentColor, footerText) validated by src/utils/email-template.ts. NULL
-- means the user has not customized their receipt and the platform default
-- template is used.
ALTER TABLE "NotificationPreference"
ADD COLUMN "emailTemplate" JSONB;
