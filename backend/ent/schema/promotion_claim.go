package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// PromotionClaim 记录用户针对某个已完成充值订单领取的返利。
type PromotionClaim struct{ ent.Schema }

func (PromotionClaim) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "promotion_claims"}}
}

func (PromotionClaim) Fields() []ent.Field {
	return []ent.Field{
		field.Int("promotion_id"),
		field.Int64("user_id"),
		field.Int64("payment_order_id"),
		field.String("out_trade_no").MaxLen(64).Default(""),
		field.Float("order_amount").SchemaType(map[string]string{dialect.Postgres: "decimal(20,2)"}),
		field.Float("rebate_amount").SchemaType(map[string]string{dialect.Postgres: "decimal(20,2)"}),
		field.String("status").MaxLen(16).Default("GRANTED"),
		field.Time("claimed_at").Default(time.Now).Immutable().SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
	}
}

func (PromotionClaim) Edges() []ent.Edge { return nil }

func (PromotionClaim) Indexes() []ent.Index {
	return []ent.Index{
		// 一个充值订单在所有促销活动中只能领取一次返利。
		index.Fields("payment_order_id").Unique(),
		index.Fields("user_id", "claimed_at"),
		index.Fields("promotion_id", "claimed_at"),
	}
}
