// Package schema defines the invoice request persistence model.
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

// InvoiceRequest is a user-submitted invoice application.  Customer details
// are deliberately snapshotted: later changes to the Sub2API profile must not
// alter an already submitted tax document request.
type InvoiceRequest struct {
	ent.Schema
}

func (InvoiceRequest) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "invoice_requests"}}
}

func (InvoiceRequest) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("user_id"),
		field.String("user_email").MaxLen(255),
		field.String("user_name").MaxLen(100).Default(""),
		field.String("invoice_title").MaxLen(200),
		field.String("taxpayer_id").MaxLen(64),
		field.String("contact_email").MaxLen(255),
		field.String("contact_phone").MaxLen(64).Default(""),
		field.String("registered_address").Optional().SchemaType(map[string]string{dialect.Postgres: "text"}),
		field.String("bank_name").MaxLen(200).Default(""),
		field.String("bank_account").MaxLen(128).Default(""),
		field.String("remark").Optional().SchemaType(map[string]string{dialect.Postgres: "text"}),
		field.Float("amount").SchemaType(map[string]string{dialect.Postgres: "decimal(20,2)"}),
		field.String("status").MaxLen(24).Default("PENDING"),
		field.String("admin_note").Optional().SchemaType(map[string]string{dialect.Postgres: "text"}),
		field.String("invoice_file_name").MaxLen(255).Default(""),
		field.String("invoice_file_path").MaxLen(512).Default(""),
		field.String("invoice_file_mime_type").MaxLen(128).Default(""),
		field.Int64("invoice_file_size").Default(0),
		field.String("invoice_file_note").MaxLen(2000).Default("").Comment("管理员对发票文件记录的备注"),
		field.Time("issued_at").Optional().Nillable().SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.Time("created_at").Default(time.Now).Immutable().SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now).SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
	}
}

func (InvoiceRequest) Edges() []ent.Edge { return nil }

func (InvoiceRequest) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_id", "created_at"),
		index.Fields("status", "created_at"),
	}
}
