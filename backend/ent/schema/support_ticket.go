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

type SupportTicket struct {
	ent.Schema
}

func (SupportTicket) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "support_tickets"}}
}

func (SupportTicket) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("user_id"),
		field.String("user_email").MaxLen(255).Default(""),
		field.String("user_name").MaxLen(100).Default(""),
		field.String("subject").MaxLen(200),
		field.String("status").MaxLen(24).Default("OPEN"),
		field.Time("created_at").Default(time.Now).Immutable().SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now).SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
	}
}

func (SupportTicket) Edges() []ent.Edge { return nil }

func (SupportTicket) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_id", "updated_at"),
		index.Fields("status", "updated_at"),
	}
}
