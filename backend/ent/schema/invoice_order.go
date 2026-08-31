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

// InvoiceOrder locks one completed Sub2API balance-recharge order to one
// invoice request.  payment_order_id is globally unique, preventing an order
// from being invoiced twice even under concurrent submissions.
type InvoiceOrder struct{ ent.Schema }

func (InvoiceOrder) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "invoice_orders"}}
}

func (InvoiceOrder) Fields() []ent.Field {
	return []ent.Field{
		field.Int("invoice_request_id"),
		field.Int64("payment_order_id").Unique(),
		field.String("out_trade_no").MaxLen(64).Default(""),
		field.Float("amount").SchemaType(map[string]string{dialect.Postgres: "decimal(20,2)"}),
		field.Time("paid_at").Optional().Nillable().SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.Time("created_at").Default(time.Now).Immutable().SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
	}
}

func (InvoiceOrder) Edges() []ent.Edge    { return nil }
func (InvoiceOrder) Indexes() []ent.Index { return []ent.Index{index.Fields("invoice_request_id")} }
