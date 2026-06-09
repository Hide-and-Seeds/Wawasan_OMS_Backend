-- ============================================================
-- Wawasan Candle OMS — DEMO / SHOWCASE data  (REAL客户 + REAL SKU)
-- ------------------------------------------------------------
-- Built from the client's actual MONTHLY STOCKLIST 2026 (STK finished-
-- goods sheet) and 5 real SQL Account sales invoices (SI26060059–063).
-- Customers, product names, UOM (CTN/BOX) and line quantities all mirror
-- real Wawasan documents. Money is intentionally NOT stored here — it
-- lives in SQL Account; the OMS only tracks the operational pipeline.
-- The SI number + PO ref + payment terms are kept in orders.notes.
--
-- Paste into the Supabase SQL editor and Run. Safe + re-runnable:
-- it deletes its own demo rows first (everything prefixed WC-DEMO-).
-- Children (items / transitions / deliveries / notifications) cascade
-- or are cleared inside the block. Real orders are untouched.
--
-- TO REMOVE the demo afterwards:
--   DELETE FROM orders WHERE invoice_number LIKE 'WC-DEMO-%';
-- ============================================================

DO $$
DECLARE
  boss uuid; ops uuid; lead uuid; ali uuid; siti uuid; disp uuid;
  own uuid; jt uuid;
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; o6 uuid;
  o7 uuid; o8 uuid; o9 uuid; o10 uuid; o11 uuid; o12 uuid;
BEGIN
  -- ---- clear previous demo run --------------------------------
  DELETE FROM orders WHERE invoice_number LIKE 'WC-DEMO-%';

  -- ---- look up the seeded users + couriers --------------------
  SELECT id INTO boss FROM users WHERE email = 'admin@wawasancandle.com';
  SELECT id INTO ops  FROM users WHERE email = 'reenee@wawasancandle.com';
  SELECT id INTO lead FROM users WHERE email = 'misha@wawasancandle.com';
  SELECT id INTO ali  FROM users WHERE email = 'ali@wawasancandle.com';
  SELECT id INTO siti FROM users WHERE email = 'siti@wawasancandle.com';
  SELECT id INTO disp FROM users WHERE email = 'dispatch@wawasancandle.com';
  IF disp IS NULL THEN SELECT id INTO disp FROM users WHERE role = 'delivery_team' LIMIT 1; END IF;
  SELECT id INTO own FROM deliverers WHERE name = 'Own Driver'   LIMIT 1;
  SELECT id INTO jt  FROM deliverers WHERE name = 'J&T Express'  LIMIT 1;

  o1:=gen_random_uuid(); o2:=gen_random_uuid(); o3:=gen_random_uuid();
  o4:=gen_random_uuid(); o5:=gen_random_uuid(); o6:=gen_random_uuid();
  o7:=gen_random_uuid(); o8:=gen_random_uuid(); o9:=gen_random_uuid();
  o10:=gen_random_uuid(); o11:=gen_random_uuid(); o12:=gen_random_uuid();

  -- ---- ORDERS (real trade customers from the invoices) --------
  -- o8 reproduces real invoice SI26060059 faithfully (Perfect Design,
  -- 10 CTN Fire Chicken + 2 CTN Serai Lilin). Others use the same real
  -- customers/SKUs spread across the kanban so every stage is populated.
  INSERT INTO orders
    (id, invoice_number, customer_name, customer_contact, order_date, required_delivery_date, expiry_date,
     stage, priority, importance, skip_production, pic_id, notes, on_hold, waiting_stock, hold_reason,
     source, created_by, created_at) VALUES
  (o1 ,'WC-DEMO-001','CHECKERS HYPERMARKET SDN BHD'   ,'03-91075151' ,CURRENT_DATE  ,CURRENT_DATE+3,NULL           ,'order'             ,'normal','priority',false,ops ,'SQL Account SI26060060 · PO26060462JCU · 30 Days',false,false,NULL,'sql_account',ops ,now()-interval '4 hours'),
  (o2 ,'WC-DEMO-002','TAN NAM SENG BROTHERS SDN BHD'  ,'03-62765463' ,CURRENT_DATE  ,CURRENT_DATE+3,NULL           ,'order'             ,'urgent','vip'     ,false,ops ,'SQL Account SI26060063 · C.O.D. — bulk reorder, due this week',false,false,NULL,'sql_account',boss,now()-interval '3 hours'),
  (o3 ,'WC-DEMO-003','SENGHIN HANG TRADING SDN BHD'   ,'03-51612539' ,CURRENT_DATE-2,CURRENT_DATE+4,NULL           ,'production'        ,'normal','priority',false,ali ,'SQL Account SI26060061 · C.O.D.',false,false,NULL,'sql_account',ops ,now()-interval '2 days'),
  (o4 ,'WC-DEMO-004','TAN NAM SENG BROTHERS SDN BHD'  ,'03-62765463' ,CURRENT_DATE-1,CURRENT_DATE+1,NULL           ,'production'        ,'urgent','vip'     ,false,lead,'SQL Account SI26060062 · C.O.D. — 45 CTN run',false,false,NULL,'sql_account',ops ,now()-interval '30 hours'),
  (o5 ,'WC-DEMO-005','CHECKERS HYPERMARKET SDN BHD'   ,'03-91075151' ,CURRENT_DATE-2,CURRENT_DATE+6,NULL           ,'production'        ,'normal','standard',false,ali ,'SQL Account SI26060057 · 30 Days',false,true ,'Citronella oil (ST00064) shipment delayed','sql_account',ops ,now()-interval '2 days'),
  (o6 ,'WC-DEMO-006','PERFECT DESIGN TRADING SDN BHD' ,'011-10841868',CURRENT_DATE-4,CURRENT_DATE+3,NULL           ,'packing'           ,'normal','priority',false,siti,'SQL Account SI26060056 · PO-001648 · C.O.D.',false,false,NULL,'sql_account',ops ,now()-interval '4 days'),
  (o7 ,'WC-DEMO-007','CHECKERS HYPERMARKET SDN BHD'   ,'03-91075151' ,CURRENT_DATE-3,CURRENT_DATE  ,NULL           ,'packing'           ,'urgent','standard',false,siti,'Due today — SQL Account SI26060052 · 30 Days',false,false,NULL,'sql_account',ops ,now()-interval '3 days'),
  (o8 ,'WC-DEMO-008','PERFECT DESIGN TRADING SDN BHD' ,'011-10841868',CURRENT_DATE-5,CURRENT_DATE+1,NULL           ,'ready_for_delivery','normal','vip'     ,false,NULL,'SQL Account SI26060059 · PO-001652 · C.O.D.',false,false,NULL,'sql_account',ops ,now()-interval '5 days'),
  (o9 ,'WC-DEMO-009','SENGHIN HANG TRADING SDN BHD'   ,'03-51612539' ,CURRENT_DATE-5,CURRENT_DATE  ,NULL           ,'ready_for_delivery','normal','standard',false,NULL,'SQL Account SI26060050 · C.O.D.',false,false,NULL,'sql_account',ops ,now()-interval '5 days'),
  (o10,'WC-DEMO-010','TAN NAM SENG BROTHERS SDN BHD'  ,'03-62765463' ,CURRENT_DATE-9,CURRENT_DATE-2,NULL           ,'delivered'         ,'normal','standard',false,NULL,'SQL Account SI26060046 · C.O.D.',false,false,NULL,'sql_account',ops ,now()-interval '9 days'),
  (o11,'WC-DEMO-011','CHECKERS HYPERMARKET SDN BHD'   ,'03-91075151' ,CURRENT_DATE-12,CURRENT_DATE-5,NULL          ,'delivered'         ,'normal','priority',false,NULL,'SQL Account SI26060043 · PO26060351JCU · 30 Days',false,false,NULL,'sql_account',ops ,now()-interval '12 days'),
  (o12,'WC-DEMO-012','PERFECT DESIGN TRADING SDN BHD' ,'011-10841868',CURRENT_DATE-2,CURRENT_DATE+7,NULL           ,'production'        ,'normal','standard',false,ali ,'On hold — SQL Account SI26060058 · PO-001655',true ,false,'Awaiting sticker artwork approval (ST00340)','sql_account',ops ,now()-interval '2 days');

  -- ---- ORDER ITEMS (real STK SKUs, real UOM; status drives kanban %) --
  INSERT INTO order_items (id, order_id, sku, name, quantity, unit, made, made_at, made_by, made_qty, status) VALUES
  -- o1 Checkers — multi-line invoice (SI26060060)
  (gen_random_uuid(),o1 ,'STK006','FIRE CHICKEN FIRESTARTER (40 BIJI) - 72 BOX/CTN'       , 1,'CTN',false,NULL,NULL,0,'not_started'),
  (gen_random_uuid(),o1 ,'STK026','LILIN PIALA EMAS (ITEM NO:2288) 6''S - 50 BOX/CTN'     , 1,'CTN',false,NULL,NULL,0,'not_started'),
  (gen_random_uuid(),o1 ,'STK060','TEA LIGHTS 100PCS - 37 X 15 (20 PACKS/CTN)'            , 1,'CTN',false,NULL,NULL,0,'not_started'),
  (gen_random_uuid(),o1 ,'STK103','SERAI LILIN 37X10 (2H) - 50''S/PACK (24 PACKS/CTN)'    , 1,'CTN',false,NULL,NULL,0,'not_started'),
  -- o2 Tan Nam Seng — bulk Flying Horse (SI26060063)
  (gen_random_uuid(),o2 ,'STK008','FLYING HORSE FIRE STARTER (40 BIJI) - 72 BOX/CTN'      ,50,'CTN',false,NULL,NULL,0,'not_started'),
  -- o3 Senghin Hang — in production (SI26060061)
  (gen_random_uuid(),o3 ,'STK006','FIRE CHICKEN FIRESTARTER (40 BIJI) - 72 BOX/CTN'       ,10,'CTN',false,now()-interval '6 hours',ali,4,'in_progress'),
  -- o4 Tan Nam Seng — 45 CTN run in production (SI26060062)
  (gen_random_uuid(),o4 ,'STK008','FLYING HORSE FIRE STARTER (40 BIJI) - 72 BOX/CTN'      ,45,'CTN',false,now()-interval '5 hours',lead,20,'in_progress'),
  -- o5 Checkers — waiting on oil stock
  (gen_random_uuid(),o5 ,'STK035','SERAI LILIN ANTI INSECTS CANDLES - 2PCS/PACK (66 PACKS/CTN)',4,'CTN',false,NULL,NULL,0,'not_started'),
  (gen_random_uuid(),o5 ,'STK086','SERAI ANTI LALAT (37X10) - 10''S'                      , 2,'CTN',false,NULL,NULL,0,'not_started'),
  -- o6 Perfect Design — in packing
  (gen_random_uuid(),o6 ,'STK006','FIRE CHICKEN FIRESTARTER (40 BIJI) - 72 BOX/CTN'       , 6,'CTN',true ,now()-interval '20 hours',ali,6,'done'),
  (gen_random_uuid(),o6 ,'STK035','SERAI LILIN ANTI INSECTS CANDLES - 2PCS/PACK (66 PACKS/CTN)',3,'CTN',true ,now()-interval '18 hours',ali,3,'done'),
  -- o7 Checkers — in packing, due today
  (gen_random_uuid(),o7 ,'STK060','TEA LIGHTS 100PCS - 37 X 15 (20 PACKS/CTN)'            , 5,'CTN',true ,now()-interval '26 hours',ali,5,'done'),
  (gen_random_uuid(),o7 ,'STK061','TEALIGHTS 50PCS - 37 X 24 (12 PACKS/CTN)'              , 3,'CTN',true ,now()-interval '25 hours',ali,3,'done'),
  -- o8 Perfect Design — READY (faithful copy of real invoice SI26060059)
  (gen_random_uuid(),o8 ,'STK006','FIRE CHICKEN FIRESTARTER (40 BIJI) - 72 BOX/CTN'       ,10,'CTN',true ,now()-interval '2 days',ali,10,'done'),
  (gen_random_uuid(),o8 ,'STK035','SERAI LILIN ANTI INSECTS CANDLES - 2PCS/PACK (66 PACKS/CTN)',2,'CTN',true ,now()-interval '2 days',ali,2,'done'),
  -- o9 Senghin Hang — ready
  (gen_random_uuid(),o9 ,'STK008','FLYING HORSE FIRE STARTER (40 BIJI) - 72 BOX/CTN'      ,20,'CTN',true ,now()-interval '2 days',ali,20,'done'),
  (gen_random_uuid(),o9 ,'STK022','KIBI BRAND FIRESTARTER'                                , 5,'CTN',true ,now()-interval '2 days',ali,5,'done'),
  -- o10 Tan Nam Seng — delivered
  (gen_random_uuid(),o10,'STK008','FLYING HORSE FIRE STARTER (40 BIJI) - 72 BOX/CTN'      ,40,'CTN',true ,now()-interval '6 days',ali,40,'done'),
  -- o11 Checkers — delivered
  (gen_random_uuid(),o11,'STK026','LILIN PIALA EMAS (ITEM NO:2288) 6''S - 50 BOX/CTN'     , 2,'CTN',true ,now()-interval '8 days',ali,2,'done'),
  (gen_random_uuid(),o11,'STK120','WHITE CANDLE 998 9.7 INCH (2''S) - 50 BOX/CTN'         , 2,'CTN',true ,now()-interval '8 days',ali,2,'done'),
  -- o12 Perfect Design — on hold (artwork)
  (gen_random_uuid(),o12,'STK131','LILIN PIALA EMAS (ITEM NO:3399) - 6''S X 40 BOXES/CTN' , 5,'BOX',false,NULL,NULL,0,'not_started');

  -- ---- PACKING PROGRESS -------------------------------------
  -- Packing has its own per-SKU columns (pack_status/pack_made/...); the kanban
  -- + floor count the stage-correct column, so an item done in production still
  -- reads 0% in packing until packed. Mark packing done for every order that has
  -- reached or passed packing, packed by Siti, with stage-appropriate times.
  UPDATE order_items oi
  SET pack_status='done', pack_made=true, pack_made_by=siti,
      pack_made_at = CASE o.stage
        WHEN 'packing'            THEN now()-interval '6 hours'
        WHEN 'ready_for_delivery' THEN now()-interval '20 hours'
        WHEN 'delivered'          THEN now()-interval '4 days'
      END
  FROM orders o
  WHERE o.id=oi.order_id AND o.id IN (o6,o7,o8,o9,o10,o11);

  -- ---- STAGE TRANSITIONS (feed the timing/throughput reports) -
  INSERT INTO stage_transitions (id, order_id, from_stage, to_stage, transitioned_by, reason, created_at) VALUES
  -- in production now
  (gen_random_uuid(),o3 ,'order','production',ops,NULL,now()-interval '1 day 12 hours'),
  (gen_random_uuid(),o4 ,'order','production',ops,NULL,now()-interval '1 day'),
  (gen_random_uuid(),o5 ,'order','production',ops,NULL,now()-interval '1 day 6 hours'),
  (gen_random_uuid(),o12,'order','production',ops,NULL,now()-interval '1 day 8 hours'),
  -- in packing now (o6 includes a rework loop for the report)
  (gen_random_uuid(),o6 ,'order'     ,'production',ops ,NULL,now()-interval '3 days'),
  (gen_random_uuid(),o6 ,'production','packing'   ,ali ,NULL,now()-interval '30 hours'),
  (gen_random_uuid(),o6 ,'packing'   ,'production',lead,'Wax surface uneven — recast top layer',now()-interval '26 hours'),
  (gen_random_uuid(),o6 ,'production','packing'   ,ali ,NULL,now()-interval '14 hours'),
  (gen_random_uuid(),o7 ,'order'     ,'production',ops ,NULL,now()-interval '2 days 18 hours'),
  (gen_random_uuid(),o7 ,'production','packing'   ,ali ,NULL,now()-interval '26 hours'),
  -- ready for delivery
  (gen_random_uuid(),o8 ,'order'     ,'production',ops ,NULL,now()-interval '4 days'),
  (gen_random_uuid(),o8 ,'production','packing'   ,ali ,NULL,now()-interval '2 days'),
  (gen_random_uuid(),o8 ,'packing'   ,'ready_for_delivery',siti,NULL,now()-interval '16 hours'),
  (gen_random_uuid(),o9 ,'order'     ,'production',ops ,NULL,now()-interval '4 days 6 hours'),
  (gen_random_uuid(),o9 ,'production','packing'   ,ali ,NULL,now()-interval '2 days 4 hours'),
  (gen_random_uuid(),o9 ,'packing'   ,'ready_for_delivery',siti,NULL,now()-interval '22 hours'),
  -- delivered
  (gen_random_uuid(),o10,'order'     ,'production',ops ,NULL,now()-interval '8 days'),
  (gen_random_uuid(),o10,'production','packing'   ,ali ,NULL,now()-interval '6 days'),
  (gen_random_uuid(),o10,'packing'   ,'ready_for_delivery',siti,NULL,now()-interval '5 days'),
  (gen_random_uuid(),o10,'ready_for_delivery','delivered',disp,NULL,now()-interval '4 days'),
  (gen_random_uuid(),o11,'order'     ,'production',ops ,NULL,now()-interval '11 days'),
  (gen_random_uuid(),o11,'production','packing'   ,ali ,NULL,now()-interval '9 days'),
  (gen_random_uuid(),o11,'packing'   ,'ready_for_delivery',siti,NULL,now()-interval '7 days'),
  (gen_random_uuid(),o11,'ready_for_delivery','delivered',disp,NULL,now()-interval '6 days');

  -- ---- DELIVERIES (B2B trade — mostly own lorry, DO numbers) --
  INSERT INTO deliveries (id, order_id, delivery_man_id, deliverer_id, scheduled_date, address, tracking_no, delivered_at, status, notes, created_at) VALUES
  (gen_random_uuid(),o8 ,NULL,own,CURRENT_DATE+1,'NO. 8 & 10, JALAN BALAU 1, PUSAT PERINDUSTRIAN BALAU, 72100 BAHAU, NEGERI SEMBILAN','DO-2606-018',NULL,'pending',NULL,now()-interval '12 hours'),
  (gen_random_uuid(),o9 ,NULL,own,CURRENT_DATE  ,'LOT 10425, A7, BATU 4 1/2, KAMPUNG JAWA, 41000 KLANG, SELANGOR'                    ,'DO-2606-016',NULL,'pending',NULL,now()-interval '20 hours'),
  (gen_random_uuid(),o10,NULL,own,CURRENT_DATE-3,'LOT 54, JALAN E1/2, TAMAN EHSAN IND. ESTATE, BATU 8, JALAN KEPONG, 52100 KUALA LUMPUR','DO-2606-009',now()-interval '4 days','delivered',NULL,now()-interval '5 days'),
  (gen_random_uuid(),o11,NULL,jt ,CURRENT_DATE-6,'LOT PT 38284, JALAN CHERAS UTAMA 15, TAMAN CHERAS UTAMA, 43200 CHERAS, KUALA LUMPUR' ,'JT-2606-7705',now()-interval '6 days','delivered',NULL,now()-interval '7 days');

  -- ---- NOTIFICATIONS (the bell — leave unread for the demo) ---
  INSERT INTO notifications (id, user_id, type, title, message, order_id, is_read, created_at) VALUES
  (gen_random_uuid(),boss,'urgent_flag'        ,'Urgent VIP order'      ,'WC-DEMO-002 Tan Nam Seng Brothers flagged URGENT (VIP) — 50 CTN Flying Horse due this week',o2,false,now()-interval '3 hours'),
  (gen_random_uuid(),ops ,'urgent_flag'        ,'Urgent VIP order'      ,'WC-DEMO-002 Tan Nam Seng Brothers flagged URGENT (VIP) — 50 CTN Flying Horse due this week',o2,false,now()-interval '3 hours'),
  (gen_random_uuid(),ops ,'order_overdue'      ,'Order due today'       ,'WC-DEMO-007 Checkers Hypermarket is due today and still in Packing',o7,false,now()-interval '2 hours'),
  (gen_random_uuid(),lead,'pic_assigned'       ,'You are in charge'     ,'You are the person in charge of WC-DEMO-004 Tan Nam Seng Brothers (45 CTN, due tomorrow)',o4,false,now()-interval '30 hours'),
  (gen_random_uuid(),ali ,'order_stage_entered','New work in Production','WC-DEMO-003 Senghin Hang Trading entered Production',o3,false,now()-interval '1 day 12 hours'),
  (gen_random_uuid(),ali ,'rework_returned'    ,'Sent back for rework'  ,'WC-DEMO-006 returned to Production: wax surface uneven',o6,false,now()-interval '26 hours'),
  (gen_random_uuid(),disp,'order_stage_entered','Ready to schedule'     ,'WC-DEMO-008 Perfect Design Trading is ready for delivery',o8,false,now()-interval '16 hours');

  -- ---- ACTIVITY LOG (the audit trail) ------------------------
  INSERT INTO activity_log (id, order_id, user_id, action, details, created_at) VALUES
  (gen_random_uuid(),o2 ,boss,'order_created'      ,'Created WC-DEMO-002 (urgent, VIP) — Tan Nam Seng Brothers',now()-interval '3 hours'),
  (gen_random_uuid(),o3 ,ali ,'item_progress'      ,'FIRE CHICKEN FIRESTARTER (40 BIJI) - 72 BOX/CTN (in_progress)',now()-interval '6 hours'),
  (gen_random_uuid(),o4 ,lead,'item_progress'      ,'FLYING HORSE FIRE STARTER (40 BIJI) - 72 BOX/CTN (in_progress, 20/45)',now()-interval '5 hours'),
  (gen_random_uuid(),o5 ,ops ,'order_flagged'      ,'Marked waiting stock — citronella oil shipment delayed',now()-interval '1 day'),
  (gen_random_uuid(),o6 ,lead,'stage_moved'        ,'packing → production (rework)',now()-interval '26 hours'),
  (gen_random_uuid(),o7 ,ali ,'stage_moved'        ,'production → packing',now()-interval '26 hours'),
  (gen_random_uuid(),o8 ,siti,'stage_moved'        ,'packing → ready_for_delivery',now()-interval '16 hours'),
  (gen_random_uuid(),o8 ,disp,'delivery_scheduled' ,'Scheduled own-driver delivery to Bahau (DO-2606-018)',now()-interval '12 hours'),
  (gen_random_uuid(),o10,disp,'delivery_completed' ,'Marked delivered — Kepong',now()-interval '4 days'),
  (gen_random_uuid(),o12,ops ,'order_flagged'      ,'Put on hold — awaiting sticker artwork approval',now()-interval '1 day');

  RAISE NOTICE 'Wawasan demo loaded: 12 orders (real customers + real STK SKUs), items, transitions, 4 deliveries, 7 notifications.';
END $$;
