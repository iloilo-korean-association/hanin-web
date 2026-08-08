-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "group" TEXT NOT NULL DEFAULT '',
    "updatedBy" TEXT NOT NULL DEFAULT 'SYSTEM',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Member" (
    "memberNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "birthYear" INTEGER,
    "gender" TEXT NOT NULL DEFAULT '미기재',
    "phone" TEXT NOT NULL DEFAULT '',
    "phoneLast4" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "districtTeam" TEXT NOT NULL DEFAULT '',
    "householdRole" TEXT NOT NULL DEFAULT '본인',
    "joinedOn" TEXT NOT NULL,
    "memberType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "duesGrade" TEXT NOT NULL,
    "rosterConsent" BOOLEAN NOT NULL DEFAULT false,
    "notifyConsent" BOOLEAN NOT NULL DEFAULT true,
    "privacyConsentAt" TIMESTAMP(3),
    "linkToken" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL DEFAULT 'SYSTEM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "formResponseId" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Member_pkey" PRIMARY KEY ("memberNo")
);

-- CreateTable
CREATE TABLE "Account" (
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "bankName" TEXT NOT NULL DEFAULT '',
    "accountNoMasked" TEXT NOT NULL DEFAULT '',
    "holder" TEXT NOT NULL DEFAULT '',
    "openingBalance" INTEGER NOT NULL DEFAULT 0,
    "openedOn" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "manager" TEXT NOT NULL DEFAULT '',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Account_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "Fund" (
    "fundId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "startOn" TEXT NOT NULL,
    "endOn" TEXT,
    "targetAmount" INTEGER NOT NULL DEFAULT 0,
    "openingBalance" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Fund_pkey" PRIMARY KEY ("fundId")
);

-- CreateTable
CREATE TABLE "Category" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "majorType" TEXT NOT NULL,
    "midType" TEXT NOT NULL DEFAULT '',
    "publicName" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Category_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "receiptNo" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "fxRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "amountPhp" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "counterpartyType" TEXT NOT NULL,
    "counterpartyMemberNo" TEXT,
    "counterpartyName" TEXT NOT NULL DEFAULT '',
    "method" TEXT NOT NULL,
    "memo" TEXT NOT NULL DEFAULT '',
    "externalRef" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "relatedParty" BOOLEAN NOT NULL DEFAULT false,
    "approvalId" TEXT,
    "enteredBy" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedBy" TEXT NOT NULL DEFAULT '',
    "verifiedAt" TIMESTAMP(3),
    "evidenceUrl" TEXT NOT NULL DEFAULT '',
    "voidReason" TEXT NOT NULL DEFAULT '',
    "fiscalYear" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "reversalOfReceiptNo" TEXT,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("receiptNo")
);

-- CreateTable
CREATE TABLE "DuesInvoice" (
    "invoiceId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "memberNo" TEXT NOT NULL,
    "memberName" TEXT NOT NULL,
    "duesGrade" TEXT NOT NULL,
    "billedAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "billedOn" TEXT NOT NULL,
    "dueOn" TEXT NOT NULL,
    "paidAmount" INTEGER NOT NULL DEFAULT 0,
    "unpaidAmount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "lastReceiptNo" TEXT,
    "lastPaidOn" TEXT,
    "dunning1On" TEXT,
    "dunning2On" TEXT,
    "dunning3On" TEXT,
    "exemptReason" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "DuesInvoice_pkey" PRIMARY KEY ("invoiceId")
);

-- CreateTable
CREATE TABLE "Donation" (
    "donationId" TEXT NOT NULL,
    "receivedOn" TEXT NOT NULL,
    "donorType" TEXT NOT NULL,
    "donorMemberNo" TEXT,
    "donorName" TEXT NOT NULL DEFAULT '',
    "donorPhone" TEXT NOT NULL DEFAULT '',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "amountPhp" INTEGER NOT NULL,
    "isDesignated" BOOLEAN NOT NULL DEFAULT false,
    "fundId" TEXT,
    "designatedPurpose" TEXT NOT NULL DEFAULT '',
    "method" TEXT NOT NULL,
    "accountId" TEXT,
    "receiptNo" TEXT,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "publicConsent" BOOLEAN NOT NULL DEFAULT false,
    "publicDisplayName" TEXT NOT NULL DEFAULT '',
    "thanksSentOn" TEXT,
    "status" TEXT NOT NULL DEFAULT '접수',
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Donation_pkey" PRIMARY KEY ("donationId")
);

-- CreateTable
CREATE TABLE "DonationUse" (
    "useId" TEXT NOT NULL,
    "donationId" TEXT,
    "fundId" TEXT NOT NULL,
    "usedOn" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "amountPhp" INTEGER NOT NULL,
    "receiptNo" TEXT,
    "purposeText" TEXT NOT NULL,
    "evidenceUrl" TEXT NOT NULL DEFAULT '',
    "approvalId" TEXT,
    "status" TEXT NOT NULL DEFAULT '집행',
    "enteredBy" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DonationUse_pkey" PRIMARY KEY ("useId")
);

-- CreateTable
CREATE TABLE "Event" (
    "eventId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "place" TEXT NOT NULL DEFAULT '',
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "fee" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "budget" INTEGER NOT NULL DEFAULT 0,
    "ownerEmail" TEXT NOT NULL DEFAULT '',
    "signupDeadline" TEXT,
    "status" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "settlementReceiptNos" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Event_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "EventSignup" (
    "signupId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "memberNo" TEXT,
    "applicantName" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "guests" INTEGER NOT NULL DEFAULT 0,
    "totalPeople" INTEGER NOT NULL DEFAULT 1,
    "feeTotal" INTEGER NOT NULL DEFAULT 0,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "receiptNo" TEXT,
    "attendance" TEXT NOT NULL DEFAULT '예정',
    "specialNote" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '접수',
    "formResponseId" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "EventSignup_pkey" PRIMARY KEY ("signupId")
);

-- CreateTable
CREATE TABLE "Approval" (
    "approvalId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedBy" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "amountPhp" INTEGER NOT NULL,
    "fundId" TEXT,
    "categoryCode" TEXT,
    "reason" TEXT NOT NULL,
    "relatedParty" BOOLEAN NOT NULL DEFAULT false,
    "conflictId" TEXT,
    "quoteUrl" TEXT NOT NULL DEFAULT '',
    "requiredStages" INTEGER NOT NULL DEFAULT 0,
    "approver1" TEXT NOT NULL DEFAULT '',
    "approvedAt1" TIMESTAMP(3),
    "result1" TEXT NOT NULL DEFAULT '대기',
    "approver2" TEXT NOT NULL DEFAULT '',
    "approvedAt2" TIMESTAMP(3),
    "result2" TEXT NOT NULL DEFAULT '불필요',
    "finalStatus" TEXT NOT NULL DEFAULT '대기',
    "executedReceiptNo" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "counterpartyName" TEXT NOT NULL DEFAULT '',
    "vendorId" TEXT,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("approvalId")
);

-- CreateTable
CREATE TABLE "Officer" (
    "officerId" TEXT NOT NULL,
    "memberNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "termStart" TEXT NOT NULL,
    "termEnd" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "permissions" TEXT NOT NULL DEFAULT '조회권',
    "approvalLimit" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Officer_pkey" PRIMARY KEY ("officerId")
);

-- CreateTable
CREATE TABLE "ConflictOfInterest" (
    "conflictId" TEXT NOT NULL,
    "declaredOn" TEXT NOT NULL,
    "declarerMemberNo" TEXT NOT NULL,
    "declarerName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT '',
    "counterpartyType" TEXT NOT NULL,
    "counterpartyName" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "vendorId" TEXT,
    "detail" TEXT NOT NULL DEFAULT '',
    "recused" BOOLEAN NOT NULL DEFAULT false,
    "resolution" TEXT NOT NULL DEFAULT '',
    "disclosed" BOOLEAN NOT NULL DEFAULT true,
    "reviewer" TEXT NOT NULL DEFAULT '',
    "reviewedOn" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "ownershipPct" INTEGER,

    CONSTRAINT "ConflictOfInterest_pkey" PRIMARY KEY ("conflictId")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL DEFAULT '',
    "industry" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "tin" TEXT NOT NULL DEFAULT '',
    "relatedMemberNo" TEXT,
    "relatedParty" BOOLEAN NOT NULL DEFAULT false,
    "since" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT NOT NULL DEFAULT '',
    "ownershipPct" INTEGER,
    "aliases" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("vendorId")
);

-- CreateTable
CREATE TABLE "NotifyLog" (
    "logId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "memberNo" TEXT,
    "toMasked" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "relatedId" TEXT NOT NULL DEFAULT '',
    "result" TEXT NOT NULL DEFAULT 'SUCCESS',
    "errorMessage" TEXT NOT NULL DEFAULT '',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "trigger" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "NotifyLog_pkey" PRIMARY KEY ("logId")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "logId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "recordKey" TEXT NOT NULL DEFAULT '',
    "fieldName" TEXT NOT NULL DEFAULT '',
    "beforeValue" TEXT NOT NULL DEFAULT '',
    "afterValue" TEXT NOT NULL DEFAULT '',
    "changeType" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "relatedKey" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("logId")
);

-- CreateTable
CREATE TABLE "CashCount" (
    "countId" TEXT NOT NULL,
    "countedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "bookBalance" INTEGER NOT NULL,
    "countedBalance" INTEGER NOT NULL,
    "diff" INTEGER NOT NULL,
    "diffReason" TEXT NOT NULL DEFAULT '',
    "counter1" TEXT NOT NULL,
    "counter2" TEXT NOT NULL,
    "photoUrl" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '정상',
    "followUp" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashCount_pkey" PRIMARY KEY ("countId")
);

-- CreateTable
CREATE TABLE "Handover" (
    "handoverId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT '',
    "items" TEXT NOT NULL DEFAULT '',
    "balanceBefore" INTEGER NOT NULL DEFAULT 0,
    "balanceAfter" INTEGER NOT NULL DEFAULT 0,
    "accountId" TEXT,
    "signatureUrl" TEXT NOT NULL DEFAULT '',
    "attachmentUrl" TEXT NOT NULL DEFAULT '',
    "verifier" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '완료',
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Handover_pkey" PRIMARY KEY ("handoverId")
);

-- CreateTable
CREATE TABLE "Reconciliation" (
    "reconId" TEXT NOT NULL,
    "reconDate" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalAt" TIMESTAMP(3) NOT NULL,
    "externalRef" TEXT NOT NULL DEFAULT '',
    "externalAmount" INTEGER NOT NULL,
    "externalDirection" TEXT NOT NULL,
    "externalMemo" TEXT NOT NULL DEFAULT '',
    "matchedReceiptNo" TEXT,
    "matchStatus" TEXT NOT NULL,
    "diff" INTEGER NOT NULL DEFAULT 0,
    "handledBy" TEXT NOT NULL DEFAULT '',
    "handledAt" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Reconciliation_pkey" PRIMARY KEY ("reconId")
);

-- CreateTable
CREATE TABLE "FiscalYear" (
    "year" INTEGER NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "closedOn" TEXT,
    "closedBy" TEXT,
    "closingTotalPhp" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "ReceiptSequence" (
    "fiscalYear" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptSequence_pkey" PRIMARY KEY ("fiscalYear")
);

-- CreateTable
CREATE TABLE "OutboxMail" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "toName" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "linkPath" TEXT NOT NULL DEFAULT '',
    "memberNo" TEXT,
    "notifyLogId" TEXT,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "OutboxMail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MagicLink" (
    "token" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "memberNo" TEXT,
    "officerId" TEXT,
    "linkPath" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MagicLink_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "OfficerCredential" (
    "officerId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficerCredential_pkey" PRIMARY KEY ("officerId")
);

-- CreateIndex
CREATE INDEX "Setting_group_idx" ON "Setting"("group");

-- CreateIndex
CREATE UNIQUE INDEX "Member_linkToken_key" ON "Member"("linkToken");

-- CreateIndex
CREATE INDEX "Member_status_idx" ON "Member"("status");

-- CreateIndex
CREATE INDEX "Member_duesGrade_idx" ON "Member"("duesGrade");

-- CreateIndex
CREATE INDEX "Member_name_idx" ON "Member"("name");

-- CreateIndex
CREATE INDEX "Member_phoneLast4_idx" ON "Member"("phoneLast4");

-- CreateIndex
CREATE INDEX "Category_majorType_sortOrder_idx" ON "Category"("majorType", "sortOrder");

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");

-- CreateIndex
CREATE INDEX "Transaction_fiscalYear_status_idx" ON "Transaction"("fiscalYear", "status");

-- CreateIndex
CREATE INDEX "Transaction_status_direction_idx" ON "Transaction"("status", "direction");

-- CreateIndex
CREATE INDEX "Transaction_accountId_date_idx" ON "Transaction"("accountId", "date");

-- CreateIndex
CREATE INDEX "Transaction_fundId_date_idx" ON "Transaction"("fundId", "date");

-- CreateIndex
CREATE INDEX "Transaction_categoryCode_idx" ON "Transaction"("categoryCode");

-- CreateIndex
CREATE INDEX "Transaction_relatedParty_idx" ON "Transaction"("relatedParty");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_fiscalYear_seq_key" ON "Transaction"("fiscalYear", "seq");

-- CreateIndex
CREATE INDEX "DuesInvoice_status_idx" ON "DuesInvoice"("status");

-- CreateIndex
CREATE INDEX "DuesInvoice_fiscalYear_status_idx" ON "DuesInvoice"("fiscalYear", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DuesInvoice_fiscalYear_memberNo_key" ON "DuesInvoice"("fiscalYear", "memberNo");

-- CreateIndex
CREATE INDEX "Donation_receivedOn_idx" ON "Donation"("receivedOn");

-- CreateIndex
CREATE INDEX "Donation_fundId_idx" ON "Donation"("fundId");

-- CreateIndex
CREATE INDEX "DonationUse_fundId_usedOn_idx" ON "DonationUse"("fundId", "usedOn");

-- CreateIndex
CREATE INDEX "Event_status_idx" ON "Event"("status");

-- CreateIndex
CREATE INDEX "EventSignup_eventId_status_idx" ON "EventSignup"("eventId", "status");

-- CreateIndex
CREATE INDEX "Approval_finalStatus_idx" ON "Approval"("finalStatus");

-- CreateIndex
CREATE INDEX "Approval_relatedParty_idx" ON "Approval"("relatedParty");

-- CreateIndex
CREATE INDEX "Approval_requestedAt_idx" ON "Approval"("requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Officer_memberNo_key" ON "Officer"("memberNo");

-- CreateIndex
CREATE UNIQUE INDEX "Officer_email_key" ON "Officer"("email");

-- CreateIndex
CREATE INDEX "Officer_status_idx" ON "Officer"("status");

-- CreateIndex
CREATE INDEX "ConflictOfInterest_disclosed_idx" ON "ConflictOfInterest"("disclosed");

-- CreateIndex
CREATE INDEX "ConflictOfInterest_vendorId_idx" ON "ConflictOfInterest"("vendorId");

-- CreateIndex
CREATE INDEX "Vendor_relatedParty_idx" ON "Vendor"("relatedParty");

-- CreateIndex
CREATE INDEX "Vendor_status_idx" ON "Vendor"("status");

-- CreateIndex
CREATE INDEX "NotifyLog_sentAt_idx" ON "NotifyLog"("sentAt");

-- CreateIndex
CREATE INDEX "NotifyLog_kind_idx" ON "NotifyLog"("kind");

-- CreateIndex
CREATE INDEX "AuditLog_occurredAt_idx" ON "AuditLog"("occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_tableName_recordKey_idx" ON "AuditLog"("tableName", "recordKey");

-- CreateIndex
CREATE INDEX "AuditLog_severity_idx" ON "AuditLog"("severity");

-- CreateIndex
CREATE INDEX "CashCount_countedAt_idx" ON "CashCount"("countedAt");

-- CreateIndex
CREATE INDEX "Reconciliation_accountId_reconDate_idx" ON "Reconciliation"("accountId", "reconDate");

-- CreateIndex
CREATE INDEX "Reconciliation_matchStatus_idx" ON "Reconciliation"("matchStatus");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxMail_notifyLogId_key" ON "OutboxMail"("notifyLogId");

-- CreateIndex
CREATE INDEX "OutboxMail_createdAt_idx" ON "OutboxMail"("createdAt");

-- CreateIndex
CREATE INDEX "OutboxMail_kind_idx" ON "OutboxMail"("kind");

-- CreateIndex
CREATE INDEX "MagicLink_email_idx" ON "MagicLink"("email");

-- CreateIndex
CREATE INDEX "MagicLink_expiresAt_idx" ON "MagicLink"("expiresAt");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("fundId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryCode_fkey" FOREIGN KEY ("categoryCode") REFERENCES "Category"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_counterpartyMemberNo_fkey" FOREIGN KEY ("counterpartyMemberNo") REFERENCES "Member"("memberNo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "Approval"("approvalId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_reversalOfReceiptNo_fkey" FOREIGN KEY ("reversalOfReceiptNo") REFERENCES "Transaction"("receiptNo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_fiscalYear_fkey" FOREIGN KEY ("fiscalYear") REFERENCES "FiscalYear"("year") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuesInvoice" ADD CONSTRAINT "DuesInvoice_memberNo_fkey" FOREIGN KEY ("memberNo") REFERENCES "Member"("memberNo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuesInvoice" ADD CONSTRAINT "DuesInvoice_lastReceiptNo_fkey" FOREIGN KEY ("lastReceiptNo") REFERENCES "Transaction"("receiptNo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_donorMemberNo_fkey" FOREIGN KEY ("donorMemberNo") REFERENCES "Member"("memberNo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("fundId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("accountId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_receiptNo_fkey" FOREIGN KEY ("receiptNo") REFERENCES "Transaction"("receiptNo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationUse" ADD CONSTRAINT "DonationUse_donationId_fkey" FOREIGN KEY ("donationId") REFERENCES "Donation"("donationId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationUse" ADD CONSTRAINT "DonationUse_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("fundId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationUse" ADD CONSTRAINT "DonationUse_receiptNo_fkey" FOREIGN KEY ("receiptNo") REFERENCES "Transaction"("receiptNo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationUse" ADD CONSTRAINT "DonationUse_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "Approval"("approvalId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSignup" ADD CONSTRAINT "EventSignup_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("eventId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSignup" ADD CONSTRAINT "EventSignup_memberNo_fkey" FOREIGN KEY ("memberNo") REFERENCES "Member"("memberNo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSignup" ADD CONSTRAINT "EventSignup_receiptNo_fkey" FOREIGN KEY ("receiptNo") REFERENCES "Transaction"("receiptNo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("fundId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_categoryCode_fkey" FOREIGN KEY ("categoryCode") REFERENCES "Category"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_conflictId_fkey" FOREIGN KEY ("conflictId") REFERENCES "ConflictOfInterest"("conflictId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("vendorId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Officer" ADD CONSTRAINT "Officer_memberNo_fkey" FOREIGN KEY ("memberNo") REFERENCES "Member"("memberNo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictOfInterest" ADD CONSTRAINT "ConflictOfInterest_declarerMemberNo_fkey" FOREIGN KEY ("declarerMemberNo") REFERENCES "Member"("memberNo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictOfInterest" ADD CONSTRAINT "ConflictOfInterest_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("vendorId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_relatedMemberNo_fkey" FOREIGN KEY ("relatedMemberNo") REFERENCES "Member"("memberNo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotifyLog" ADD CONSTRAINT "NotifyLog_memberNo_fkey" FOREIGN KEY ("memberNo") REFERENCES "Member"("memberNo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashCount" ADD CONSTRAINT "CashCount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handover" ADD CONSTRAINT "Handover_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("accountId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_matchedReceiptNo_fkey" FOREIGN KEY ("matchedReceiptNo") REFERENCES "Transaction"("receiptNo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptSequence" ADD CONSTRAINT "ReceiptSequence_fiscalYear_fkey" FOREIGN KEY ("fiscalYear") REFERENCES "FiscalYear"("year") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxMail" ADD CONSTRAINT "OutboxMail_memberNo_fkey" FOREIGN KEY ("memberNo") REFERENCES "Member"("memberNo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxMail" ADD CONSTRAINT "OutboxMail_notifyLogId_fkey" FOREIGN KEY ("notifyLogId") REFERENCES "NotifyLog"("logId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MagicLink" ADD CONSTRAINT "MagicLink_memberNo_fkey" FOREIGN KEY ("memberNo") REFERENCES "Member"("memberNo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MagicLink" ADD CONSTRAINT "MagicLink_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "Officer"("officerId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficerCredential" ADD CONSTRAINT "OfficerCredential_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "Officer"("officerId") ON DELETE RESTRICT ON UPDATE CASCADE;
