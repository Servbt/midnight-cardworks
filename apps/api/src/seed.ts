import type { BlogPost, FaqItem, Product } from './types.js';

export const seedProducts: Product[] = [
 {id:'p1',slug:'golden-hour-commander-proxy',title:'Golden Hour Commander Proxy',description:'A premium custom commander centerpiece with bold yellow energy, dramatic shadows, and collector-grade presentation.',price:1299,saleActive:false,salePrice:null,category:'Commander',tags:['commander','foil-look','custom'],image:'https://images.unsplash.com/photo-1612036782180-6f0b6cd846fe?auto=format&fit=crop&w=900&q=80',inventory:20,active:true,featured:true},
 {id:'p2',slug:'midnight-token-pack',title:'Midnight Token Pack',description:'A coordinated token bundle for casual tables, styled like late-night arcade screens and supernatural channel-surfing.',price:899,saleActive:false,salePrice:null,category:'Tokens',tags:['tokens','bundle'],image:'https://images.unsplash.com/photo-1606167668584-78701c57f13d?auto=format&fit=crop&w=900&q=80',inventory:35,active:true,featured:true},
 {id:'p3',slug:'velvet-archive-display-card',title:'Velvet Archive Display Card',description:'Display-ready custom art card for collectors, gifts, and deck boxes that deserve a little mystery.',price:1599,saleActive:false,salePrice:null,category:'Display',tags:['collector','gift'],image:'https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?auto=format&fit=crop&w=900&q=80',inventory:12,active:true},
 {id:'p4',slug:'social-link-land-set',title:'Social Link Land Set',description:'Five-card custom land set with color-coded visual motifs and a premium casual-play finish.',price:1999,saleActive:false,salePrice:null,category:'Land Sets',tags:['lands','set','commander'],image:'https://images.unsplash.com/photo-1596495578065-6e0763fa1178?auto=format&fit=crop&w=900&q=80',inventory:18,active:true,featured:true}
];

const seededAt = '2026-06-22T00:00:00.000Z';

export const seedFaqItems: FaqItem[] = [
  { id: 'faq_tournament_legal', question: 'Are these tournament legal?', answer: 'No. Midnight Cardworks pieces are unofficial custom game pieces for casual play, display, and gifts. They are not affiliated with or endorsed by Wizards of the Coast and are not tournament legal.', sortOrder: 10, active: true, createdAt: seededAt, updatedAt: seededAt },
  { id: 'faq_custom_idea', question: 'Can I ask about a custom idea?', answer: 'Yes. Send a note through the contact page with the card name, theme, token need, or reference image. Custom requests can be quoted before checkout.', sortOrder: 20, active: true, createdAt: seededAt, updatedAt: seededAt },
  { id: 'faq_payments', question: 'How do payments work?', answer: 'Checkout runs through Stripe. Card data stays with Stripe, and the shop receives the order details needed for fulfillment and order updates.', sortOrder: 30, active: true, createdAt: seededAt, updatedAt: seededAt }
];

export const seedBlogPosts: BlogPost[] = [
  { id: 'blog_first_drop', slug: 'first-drop-notes', title: 'First Drop Notes', excerpt: 'A quick look at how Midnight Cardworks handles launch listings, casual-play clarity, and made-to-order fulfillment.', body: 'The first Midnight Cardworks drop is built around clear expectations: custom pieces for casual tables, display binders, and gifts. Each listing keeps pricing, stock, and casual-play notes visible before checkout.\n\nOrders are reviewed after Stripe confirms payment, then packed and marked fulfilled from the shop dashboard. The goal is simple: make the buying flow feel calm, clear, and collector-focused.', published: true, publishedAt: seededAt, createdAt: seededAt, updatedAt: seededAt }
];