#!/usr/bin/env python3
"""Independent #317 scalar-event oracle. No JS mapper, SQL query, plan or product output used.
Read original authored fixture, compare aware datetimes, calculate each invoice independently.
Amounts use Python arbitrary-size integers. Output becomes a fixed versioned test fixture.
"""
import datetime, hashlib, json, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'contracts/business-bi/v1/overdue.synthetic-source-v1.json'
def instant(s): return datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
def request(valid, date, known=None, sites=None):
    return {'tenantId':'SYN-TENANT-01','siteIds':sites or ['SYN_SITE_A','SYN_SITE_B'],'validCutoff':valid,'knowledgeCutoff':known or valid,'businessDate':date,'drilldownLimit':20}
CASES = {
    'JUNE':request('2026-06-30T23:59:59+02:00','2026-06-30'),
    'JULY':request('2026-07-31T23:59:59+02:00','2026-07-31'),
    'JUNE_SITE_A':request('2026-06-30T23:59:59+02:00','2026-06-30',sites=['SYN_SITE_A']),
    'EQUIVALENT_JUNE_UTC':request('2026-06-30T21:59:59Z','2026-06-30'),
    'BEFORE_MONTH':request('2026-06-30T21:59:59.999Z','2026-06-30'),
    'AT_MONTH':request('2026-07-01T00:00:00+02:00','2026-07-01'),
    'AFTER_MONTH':request('2026-06-30T22:00:00.001Z','2026-07-01'),
    'BACKDATED_RESTATEMENT':request('2026-06-30T23:59:59+02:00','2026-06-30',known='2026-07-31T23:59:59+02:00'),
    'DST_BEFORE':request('2026-10-25T00:14:59.999Z','2026-10-25',sites=['SYN_SITE_A']),
    'DST_EARLY':request('2026-10-25T02:15:00+02:00','2026-10-25',sites=['SYN_SITE_A']),
    'DST_LATER':request('2026-10-25T02:10:00+01:00','2026-10-25',sites=['SYN_SITE_A']),
    'ZERO_DENOMINATOR':request('2026-03-31T21:59:59Z','2026-03-31'),
    'COMPLETE_NONZERO':request('2026-06-01T00:00:01+02:00','2026-06-01'),
}
def calculate(source, req):
    valid, known = instant(req['validCutoff']), instant(req['knowledgeCutoff'])
    biz = datetime.date.fromisoformat(req['businessDate'])
    def eligible(row):return instant(row['validAt']) <= valid and instant(row['knownAt']) <= known
    counts = {'scopedInvoiceCount':0,'unknownInvoiceCount':0,'cancelledInvoiceCount':0,'creditBalanceInvoiceCount':0,'overdueInvoiceCount':0,'openInvoiceCount':0}
    amounts={'overdueAmountMinorUnits':0,'openAmountMinorUnits':0,'creditBalanceMinorUnits':0}
    drill=[]
    for inv in source['invoices']:
        if inv['tenantId']!=req['tenantId'] or inv['siteId'] not in req['siteIds'] or not eligible(inv):continue
        counts['scopedInvoiceCount']+=1
        events=lambda name:[x for x in source[name]if x['tenantId']==inv['tenantId'] and x['invoiceId']==inv['invoiceId'] and eligible(x)]
        payments,adjustments=events('payments'),events('adjustments')
        if any(x['kind']=='CANCEL' for x in adjustments):counts['cancelledInvoiceCount']+=1;continue
        credit=[x for x in adjustments if x['kind']=='CREDIT']
        uncertain=any(x['amountMinorUnits'] is None or x['unit'] is None or x['currency'] is None for x in [inv,*payments,*credit])
        if uncertain:counts['unknownInvoiceCount']+=1;continue
        paid=sum(x['amountMinorUnits']for x in payments)
        credited=sum(x['amountMinorUnits']for x in credit)
        balance=inv['amountMinorUnits']-paid-credited
        if balance < 0:counts['creditBalanceInvoiceCount']+=1;amounts['creditBalanceMinorUnits']-=balance;continue
        if balance == 0:continue
        if inv['dueDate'] is None:counts['unknownInvoiceCount']+=1;continue
        counts['openInvoiceCount']+=1;amounts['openAmountMinorUnits']+=balance
        if datetime.date.fromisoformat(inv['dueDate']) < biz:
            counts['overdueInvoiceCount']+=1;amounts['overdueAmountMinorUnits']+=balance
            drill.append({'invoice_id':inv['invoiceId'],'site_id':inv['siteId'],'due_date':inv['dueDate'],'balance_minor_units':str(balance),'paid':str(paid),'credited':str(credited),'payment_count':len(payments),'adjustment_count':len(adjustments)})
    subset={**counts,**{k:str(v)for k,v in amounts.items()},'ratio':None if counts['openInvoiceCount']==0 else {'numerator':counts['overdueInvoiceCount'],'denominator':counts['openInvoiceCount']},'ratioState':'ZERO_DENOMINATOR' if counts['openInvoiceCount']==0 else 'KNOWN_SUBSET_RATIO'}
    state='PARTIAL' if counts['unknownInvoiceCount'] else 'COMPLETE'
    return {'state':state,'knownSubset':subset,'overdueAmountMinorUnits':None if state=='PARTIAL'else str(amounts['overdueAmountMinorUnits']),'overdueInvoiceCount':None if state=='PARTIAL'else counts['overdueInvoiceCount'],'overdueRatio':None if state=='PARTIAL'else subset['ratio'],'drilldown':sorted(drill,key=lambda r:(r['invoice_id'],r['site_id'])),'drilldownTotal':len(drill),'drilldownTruncated':False}
def document():
    raw=SOURCE.read_bytes();source=json.loads(raw)
    return {'schemaVersion':'kaleidosphere.business-bi/overdue-stock-independent-scalar-oracle/v1','sourceBytesSHA256':hashlib.sha256(raw).hexdigest(),'algorithm':'independent Python aware-datetime per-invoice scalar event arithmetic; no product mapper/SQL/results','cases':{name:{'request':req,'expected':calculate(source,req)}for name,req in CASES.items()}}
if __name__=='__main__':
    expected=document()
    if sys.argv[1:]==['--check']:
        fixture=json.loads((ROOT/'tests/fixtures/business-bi/overdue-stock-oracle-v1.json').read_bytes())
        assert fixture==expected,'Fixed independent oracle differs from scalar recomputation'
        print(json.dumps({'oracle':'EXACT','cases':len(expected['cases']),'sourceBytesSHA256':expected['sourceBytesSHA256'],'actualIndependentComputation':True}))
    elif not sys.argv[1:]:print(json.dumps(expected,indent=2,ensure_ascii=False))
    else:raise SystemExit('Only --check or no arguments is supported')
