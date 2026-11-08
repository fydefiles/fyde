# Pricing experiment and cost model

The $0 / $5 / $20 prices and 10 / 500 / unlimited file-send allowances are provisional. No willingness-to-pay or contribution-margin validation has occurred.

A send is one immutable version made available in a verified recipient’s Fyde inbox or accepted by an external delivery provider for one recipient. These events share one transfer and one consumed unit. Searches, denials, idempotent retries and repeat access do not add sends. Terminal provider failure reverses one consumed unit only if the file was never received in the app or accessed. Unknown outcomes remain reserved. Local adapter usage belongs to a fixture ledger, separate from live periods.

| Plan | Monthly price | Send units | Storage | Download bandwidth | File size | Included external-model budget |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Free | $0 | 10 | 250 MiB | 1,024 MiB/month | 25 MiB | $0 |
| Plus | $5 | 500 | 5,120 MiB | 20,480 MiB/month | 25 MiB | $0 |
| Unlimited | $20 | No file-count cap | 20,480 MiB | 102,400 MiB/month | 25 MiB | $0 |

These are the current values in `content/plans.json`. The unlimited plan has no numerical send cap. Its independent storage/bandwidth/file-size policies are visible before checkout. Repeated downloads debit bandwidth separately, including downloads that stop after the response begins. No surprise overages or hidden count cap apply. The owner can still export originals after subscription cancellation.

For a cohort and observation window, calculate:

```text
attributable cost = provider-accepted emails × observed email cost
                 + SMS segments × observed destination/carrier cost
                 + delivered bytes × observed egress rate
                 + storage-byte time × observed storage rate
                 + extraction and model cost
                 + payment fees and refunds
                 + attributable support cost
contribution = settled subscription receipts - attributable cost
```

Keep tax and fixed overhead separate. Marketing and development costs have their own company ledger. Never substitute zero for an unknown rate, invoice, refund or allocation.

Sensitivity examples use the configured file sizes and quota only, with no assumed provider price:

- Ten 25 MiB sends to one recipient, downloaded once each, move 250 MiB. Verification and reminder emails add email cost beyond the transfer message itself.
- Five hundred 25 MiB sends, downloaded once each, move 12,500 MiB, approximately 12.21 GiB. This alone does not establish that $5 covers costs. Repeat downloads can approach the separate 20 GiB allowance.
- Unlimited file count can produce many small sends and high optional email/SMS cost even below its 100 GiB bandwidth allowance. Separate email/SMS budgets can pause external notifications while native app delivery remains available, but the advertised file-count allowance must remain unlimited. An exhausted safety budget must be displayed as a service pause, not a disguised plan quota.

`EMAIL_UNIT_COST_USD` is an operator estimate used to reserve budget before a live provider call. Actual email cost stays unknown until reconciled. Naïve's observed session micro-USD is recorded separately from its reserved task cap. No cost rate, live receipt, conversion or profit is fabricated.

Native inbox delivery has no message-provider charge; database, storage and egress costs still apply. `SMS_UNIT_COST_USD` is a conservative operator estimate per segment, including carrier/destination charges. The worker caps bodies at 480 characters and reserves Unicode multipart segments (67 characters per segment beyond 70) even for ASCII. A daily count limit covers messages; a separate USD cap covers segment estimates. SMS costs remain unknown until invoice reconciliation. No default SMS price or margin is assumed.

Case requests use the same owner send ledger and resource limits. Each released version/recipient consumes one send, including automatic requests. A retry with the same operation ID reuses its outcome; a new intent can consume another send. Multi-file requests are paged at ten candidates and report partial failures. The owner also sets an independent case-request limit and expiry. Searches, private chat and relationship labels do not grant access or consume sends. The current bounded assistant calls no external language model; hosting, database and private-chat storage costs still require observed accounting.
