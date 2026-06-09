-- ============================================================
-- Wawasan Candle OMS — DEMO / SHOWCASE data
-- ------------------------------------------------------------
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
  jt uuid; pos uuid; ninja uuid;
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
  SELECT id INTO jt    FROM deliverers WHERE name = 'J&T Express' LIMIT 1;
  SELECT id INTO pos   FROM deliverers WHERE name = 'Pos Laju'    LIMIT 1;
  SELECT id INTO ninja FROM deliverers WHERE name = 'Ninja Van'   LIMIT 1;

  o1:=gen_random_uuid(); o2:=gen_random_uuid(); o3:=gen_random_uuid();
  o4:=gen_random_uuid(); o5:=gen_random_uuid(); o6:=gen_random_uuid();
  o7:=gen_random_uuid(); o8:=gen_random_uuid(); o9:=gen_random_uuid();
  o10:=gen_random_uuid(); o11:=gen_random_uuid(); o12:=gen_random_uuid();

  -- ---- ORDERS -------------------------------------------------
  INSERT INTO orders
    (id, invoice_number, customer_name, customer_contact, order_date, required_delivery_date, expiry_date,
     stage, priority, importance, skip_production, pic_id, notes, on_hold, waiting_stock, hold_reason,
     source, created_by, created_at) VALUES
  (o1 ,'WC-DEMO-001','Tropicana Gift House','012-3456789',CURRENT_DATE-1,CURRENT_DATE+4,CURRENT_DATE+540,'order','normal','standard',false,ops ,NULL,false,false,NULL,'sql_account',boss,now()-interval '26 hours'),
  (o2 ,'WC-DEMO-002','Aroma Living KL'    ,'017-8881234',CURRENT_DATE  ,CURRENT_DATE+2,NULL          ,'order','urgent','vip'     ,false,ops ,'Corporate Raya gifting — confirm scent set',false,false,NULL,'sql_account',boss,now()-interval '3 hours'),
  (o3 ,'WC-DEMO-003','Harmoni Bazaar'     ,'013-5552020',CURRENT_DATE-3,CURRENT_DATE+5,CURRENT_DATE+400,'production','normal','priority',false,ali ,NULL,false,false,NULL,'sql_account',ops ,now()-interval '3 days'),
  (o4 ,'WC-DEMO-004','Hotel Seri Costa'   ,'019-2233445',CURRENT_DATE-2,CURRENT_DATE+1,NULL          ,'production','urgent','vip'     ,false,lead,'Welcome-amenity candles for new wing',false,false,NULL,'sql_account',ops ,now()-interval '2 days'),
  (o5 ,'WC-DEMO-005','Candle Corner Penang','011-90011223',CURRENT_DATE-2,CURRENT_DATE+6,NULL        ,'production','normal','standard',false,ali ,NULL,false,true,'Citronella oil shipment delayed','sql_account',ops ,now()-interval '2 days'),
  (o6 ,'WC-DEMO-006','Bliss Spa Retreat'  ,'016-7778899',CURRENT_DATE-4,CURRENT_DATE+3,CURRENT_DATE+300,'packing','normal','priority',false,siti,NULL,false,false,NULL,'sql_account',ops ,now()-interval '4 days'),
  (o7 ,'WC-DEMO-007','Gifted Sdn Bhd'     ,'012-3331212',CURRENT_DATE-3,CURRENT_DATE  ,NULL          ,'packing','urgent','standard',false,siti,'Due today — push',false,false,NULL,'sql_account',ops ,now()-interval '3 days'),
  (o8 ,'WC-DEMO-008','Serenity Wellness'  ,'018-4445566',CURRENT_DATE-5,CURRENT_DATE+2,NULL          ,'ready_for_delivery','normal','vip',false,NULL,NULL,false,false,NULL,'sql_account',ops ,now()-interval '5 days'),
  (o9 ,'WC-DEMO-009','Pavilion Retail'    ,'03-21181000',CURRENT_DATE-5,CURRENT_DATE+1,NULL          ,'ready_for_delivery','normal','standard',false,NULL,NULL,false,false,NULL,'sql_account',ops ,now()-interval '5 days'),
  (o10,'WC-DEMO-010','Wangsa Florist'     ,'012-6090909',CURRENT_DATE-9,CURRENT_DATE-2,NULL          ,'delivered','normal','standard',false,NULL,NULL,false,false,NULL,'sql_account',ops ,now()-interval '9 days'),
  (o11,'WC-DEMO-011','Eden Boutique'      ,'014-3201234',CURRENT_DATE-12,CURRENT_DATE-5,NULL         ,'delivered','normal','priority',false,NULL,NULL,false,false,NULL,'manual'     ,boss,now()-interval '12 days'),
  (o12,'WC-DEMO-012','Maya Concept Store' ,'017-5550101',CURRENT_DATE-2,CURRENT_DATE+7,NULL          ,'production','normal','standard',false,ali ,'On hold pending artwork',true,false,'Awaiting customer artwork approval','sql_account',ops,now()-interval '2 days');

  -- ---- ORDER ITEMS (status drives the kanban %/floor counts) --
  INSERT INTO order_items (id, order_id, sku, name, quantity, unit, made, made_at, made_by, made_qty, status) VALUES
  (gen_random_uuid(),o1 ,'CND-LAV-200','Lavender Soy Candle 200g',120,'pcs',false,NULL,NULL,0,'not_started'),
  (gen_random_uuid(),o1 ,'CND-VAN-150','Vanilla Bean Candle 150g', 80,'pcs',false,NULL,NULL,0,'not_started'),
  (gen_random_uuid(),o2 ,'GIFT-SET-3' ,'Festive Gift Set (3 candles)',50,'set',false,NULL,NULL,0,'not_started'),
  (gen_random_uuid(),o3 ,'CND-SAN-300','Sandalwood Pillar 300g'  , 60,'pcs',false,now()-interval '6 hours',ali,30,'in_progress'),
  (gen_random_uuid(),o3 ,'CND-ROS-100','Rose Tealight (12pk)'    , 40,'pck',false,NULL,NULL,0,'not_started'),
  (gen_random_uuid(),o4 ,'CND-OUD-250','Oud Luxury Jar 250g'     ,100,'pcs',false,now()-interval '5 hours',lead,55,'in_progress'),
  (gen_random_uuid(),o5 ,'CND-CIT-180','Citronella Outdoor 180g' ,200,'pcs',false,NULL,NULL,0,'not_started'),
  (gen_random_uuid(),o6 ,'CND-OCE-200','Ocean Breeze 200g'       , 90,'pcs',true ,now()-interval '22 hours',ali,90,'done'),
  (gen_random_uuid(),o6 ,'CND-VAN-150','Vanilla Bean Candle 150g', 90,'pcs',true ,now()-interval '21 hours',ali,90,'done'),
  (gen_random_uuid(),o7 ,'CND-LAV-200','Lavender Soy Candle 200g',150,'pcs',true ,now()-interval '28 hours',ali,150,'done'),
  (gen_random_uuid(),o8 ,'CND-OUD-250','Oud Luxury Jar 250g'     , 75,'pcs',true ,now()-interval '2 days',ali,75,'done'),
  (gen_random_uuid(),o8 ,'GIFT-SET-3' ,'Festive Gift Set (3 candles)',30,'set',true,now()-interval '2 days',ali,30,'done'),
  (gen_random_uuid(),o9 ,'CND-ROS-100','Rose Tealight (12pk)'    ,200,'pck',true ,now()-interval '2 days',ali,200,'done'),
  (gen_random_uuid(),o10,'CND-VAN-150','Vanilla Bean Candle 150g',100,'pcs',true ,now()-interval '6 days',ali,100,'done'),
  (gen_random_uuid(),o11,'CND-SAN-300','Sandalwood Pillar 300g'  , 60,'pcs',true ,now()-interval '8 days',ali,60,'done'),
  (gen_random_uuid(),o11,'CND-LAV-200','Lavender Soy Candle 200g', 60,'pcs',true ,now()-interval '8 days',ali,60,'done'),
  (gen_random_uuid(),o12,'CND-OCE-200','Ocean Breeze 200g'       ,120,'pcs',false,NULL,NULL,0,'not_started');

  -- ---- STAGE TRANSITIONS (feed the timing/throughput reports) -
  INSERT INTO stage_transitions (id, order_id, from_stage, to_stage, transitioned_by, reason, created_at) VALUES
  -- in production now
  (gen_random_uuid(),o3 ,'order','production',ops,NULL,now()-interval '2 days 6 hours'),
  (gen_random_uuid(),o4 ,'order','production',ops,NULL,now()-interval '1 day 4 hours'),
  (gen_random_uuid(),o5 ,'order','production',ops,NULL,now()-interval '1 day'),
  (gen_random_uuid(),o12,'order','production',ops,NULL,now()-interval '1 day 2 hours'),
  -- in packing now
  (gen_random_uuid(),o6 ,'order'     ,'production',ops,NULL,now()-interval '3 days'),
  (gen_random_uuid(),o6 ,'packing'   ,'production',lead,'Wax finish uneven — redo top layer',now()-interval '2 days'),
  (gen_random_uuid(),o6 ,'production','packing'   ,ali,NULL,now()-interval '20 hours'),
  (gen_random_uuid(),o7 ,'order'     ,'production',ops,NULL,now()-interval '2 days 8 hours'),
  (gen_random_uuid(),o7 ,'production','packing'   ,ali,NULL,now()-interval '28 hours'),
  -- ready for delivery
  (gen_random_uuid(),o8 ,'order'     ,'production',ops,NULL,now()-interval '4 days'),
  (gen_random_uuid(),o8 ,'production','packing'   ,ali,NULL,now()-interval '2 days'),
  (gen_random_uuid(),o8 ,'packing'   ,'ready_for_delivery',siti,NULL,now()-interval '18 hours'),
  (gen_random_uuid(),o9 ,'order'     ,'production',ops,NULL,now()-interval '4 days 3 hours'),
  (gen_random_uuid(),o9 ,'production','packing'   ,ali,NULL,now()-interval '2 days 5 hours'),
  (gen_random_uuid(),o9 ,'packing'   ,'ready_for_delivery',siti,NULL,now()-interval '1 day'),
  -- delivered
  (gen_random_uuid(),o10,'order'     ,'production',ops,NULL,now()-interval '8 days'),
  (gen_random_uuid(),o10,'production','packing'   ,ali,NULL,now()-interval '6 days'),
  (gen_random_uuid(),o10,'packing'   ,'ready_for_delivery',siti,NULL,now()-interval '5 days'),
  (gen_random_uuid(),o10,'ready_for_delivery','delivered',disp,NULL,now()-interval '4 days'),
  (gen_random_uuid(),o11,'order'     ,'production',ops,NULL,now()-interval '11 days'),
  (gen_random_uuid(),o11,'production','packing'   ,ali,NULL,now()-interval '8 days'),
  (gen_random_uuid(),o11,'packing'   ,'ready_for_delivery',siti,NULL,now()-interval '7 days'),
  (gen_random_uuid(),o11,'ready_for_delivery','delivered',disp,NULL,now()-interval '6 days');

  -- ---- DELIVERIES --------------------------------------------
  INSERT INTO deliveries (id, order_id, delivery_man_id, deliverer_id, scheduled_date, address, tracking_no, delivered_at, status, notes, created_at) VALUES
  (gen_random_uuid(),o8 ,NULL,jt   ,CURRENT_DATE+1,'No 12, Jalan Mawar, 47800 Petaling Jaya, Selangor','JT-DEMO-8821',NULL,'pending',NULL,now()-interval '12 hours'),
  (gen_random_uuid(),o9 ,NULL,pos  ,CURRENT_DATE  ,'Lot 5, Pavilion KL, 55100 Kuala Lumpur'           ,'POS-DEMO-3310',NULL,'pending',NULL,now()-interval '1 day'),
  (gen_random_uuid(),o10,NULL,jt   ,CURRENT_DATE-3,'88 Jalan Wangsa, 53300 Kuala Lumpur'              ,'JT-DEMO-7705',now()-interval '4 days','delivered',NULL,now()-interval '5 days'),
  (gen_random_uuid(),o11,NULL,ninja,CURRENT_DATE-6,'23 Eden Lane, 10400 George Town, Penang'          ,'NV-DEMO-9912',now()-interval '6 days','delivered',NULL,now()-interval '7 days');

  -- ---- NOTIFICATIONS (the bell — leave unread for the demo) ---
  INSERT INTO notifications (id, user_id, type, title, message, order_id, is_read, created_at) VALUES
  (gen_random_uuid(),boss,'urgent_flag'        ,'Urgent VIP order'      ,'WC-DEMO-002 Aroma Living KL flagged URGENT (VIP) — due in 2 days',o2,false,now()-interval '3 hours'),
  (gen_random_uuid(),ops ,'urgent_flag'        ,'Urgent VIP order'      ,'WC-DEMO-002 Aroma Living KL flagged URGENT (VIP) — due in 2 days',o2,false,now()-interval '3 hours'),
  (gen_random_uuid(),ops ,'order_overdue'      ,'Order due today'       ,'WC-DEMO-007 Gifted Sdn Bhd is due today and still in Packing',o7,false,now()-interval '2 hours'),
  (gen_random_uuid(),lead,'pic_assigned'       ,'You are in charge'     ,'You are the person in charge of WC-DEMO-004 Hotel Seri Costa (due tomorrow)',o4,false,now()-interval '2 days'),
  (gen_random_uuid(),ali ,'order_stage_entered','New work in Production','WC-DEMO-003 Harmoni Bazaar entered Production',o3,false,now()-interval '2 days 6 hours'),
  (gen_random_uuid(),ali ,'rework_returned'    ,'Sent back for rework'  ,'WC-DEMO-006 returned to Production: wax finish uneven',o6,false,now()-interval '2 days'),
  (gen_random_uuid(),disp,'order_stage_entered','Ready to schedule'     ,'WC-DEMO-008 Serenity Wellness is ready for delivery',o8,false,now()-interval '18 hours');

  -- ---- ACTIVITY LOG (the audit trail) ------------------------
  INSERT INTO activity_log (id, order_id, user_id, action, details, created_at) VALUES
  (gen_random_uuid(),o2 ,boss,'order_created'      ,'Created WC-DEMO-002 (urgent, VIP)',now()-interval '3 hours'),
  (gen_random_uuid(),o3 ,ali ,'item_progress'      ,'CND-SAN-300 — Sandalwood Pillar 300g (in_progress)',now()-interval '6 hours'),
  (gen_random_uuid(),o6 ,lead,'stage_moved'        ,'packing → production (rework)',now()-interval '2 days'),
  (gen_random_uuid(),o6 ,ali ,'item_made'          ,'CND-OCE-200 — Ocean Breeze 200g (done)',now()-interval '22 hours'),
  (gen_random_uuid(),o7 ,ali ,'stage_moved'        ,'production → packing',now()-interval '28 hours'),
  (gen_random_uuid(),o8 ,siti,'stage_moved'        ,'packing → ready_for_delivery',now()-interval '18 hours'),
  (gen_random_uuid(),o8 ,disp,'delivery_scheduled' ,'Scheduled with J&T Express (JT-DEMO-8821)',now()-interval '12 hours'),
  (gen_random_uuid(),o10,disp,'delivery_completed' ,'Marked delivered',now()-interval '4 days'),
  (gen_random_uuid(),o12,ops ,'order_flagged'      ,'Put on hold — awaiting customer artwork',now()-interval '1 day');

  RAISE NOTICE 'Wawasan demo data loaded: 12 orders, items, transitions, 4 deliveries, 7 notifications.';
END $$;
