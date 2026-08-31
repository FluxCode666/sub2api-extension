package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
)

// InvoiceProfile stores the reusable billing information for one Sub2API
// customer.  It intentionally contains no order or invoice status fields:
// those remain immutable snapshots on InvoiceRequest.
type InvoiceProfile struct {
	ent.Schema
}

func (InvoiceProfile) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "invoice_profiles"}}
}

func (InvoiceProfile) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("user_id").Unique(),
		field.String("invoice_title").MaxLen(200),
		field.String("taxpayer_id").MaxLen(64),
		field.String("contact_email").MaxLen(255),
		field.String("contact_phone").MaxLen(64).Default(""),
		field.String("registered_address").Optional().SchemaType(map[string]string{dialect.Postgres: "text"}),
		field.String("bank_name").MaxLen(200).Default(""),
		field.String("bank_account").MaxLen(128).Default(""),
		field.Time("created_at").Default(time.Now).Immutable().SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now).SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
	}
}

func (InvoiceProfile) Edges() []ent.Edge    { return nil }
func (InvoiceProfile) Indexes() []ent.Index { return nil }
