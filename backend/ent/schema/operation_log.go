// Package schema 定义附属内容系统的 Ent schema。
//
// OperationLog 是管理员操作审计记录，只追加保存，不允许修改或删除。
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

// OperationLog 记录受保护管理端的写操作及其结果。
type OperationLog struct {
	ent.Schema
}

func (OperationLog) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "operation_logs"}}
}

func (OperationLog) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("user_id").Optional().Comment("执行操作的管理员用户 ID"),
		field.String("username").MaxLen(255).Optional().Comment("执行操作的管理员用户名"),
		field.String("action").MaxLen(128).NotEmpty().Comment("操作动作，如 create/update/delete"),
		field.String("resource").MaxLen(128).Optional().Comment("操作资源"),
		field.String("resource_id").MaxLen(128).Optional().Comment("资源标识"),
		field.String("status").MaxLen(16).Default("success").Comment("操作结果: success/failure"),
		field.String("details").Optional().SchemaType(map[string]string{dialect.Postgres: "text"}).Comment("操作详情"),
		field.String("ip_address").MaxLen(64).Optional().Comment("客户端 IP"),
		field.Time("created_at").Default(time.Now).Immutable().SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Comment("记录时间"),
	}
}

func (OperationLog) Edges() []ent.Edge { return nil }

func (OperationLog) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_id", "created_at"),
		index.Fields("status", "created_at"),
		index.Fields("created_at"),
	}
}
