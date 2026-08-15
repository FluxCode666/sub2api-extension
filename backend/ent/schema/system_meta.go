// Package schema 定义附属内容系统的 Ent schema。
//
// 本单元（U1）仅建立生成框架。后续单元会在此追加：
//   - U5: PageView（页面访问埋点）、FeatureClick（功能使用埋点）
//
// 为让 `go generate ./ent` 能产出可初始化的 Client 框架，ent 至少需要一个 schema。
// 此处保留一个占位 schema，U5 追加真实 schema 时可保留或删除。
package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
)

// SystemMeta 是附属系统的元信息占位实体，用于在 U1 阶段让 ent generate
// 产出可用的 Client 框架。后续单元可按需保留或移除。
type SystemMeta struct {
	ent.Schema
}

func (SystemMeta) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "system_meta"},
	}
}

func (SystemMeta) Fields() []ent.Field {
	return []ent.Field{
		field.String("key").
			MaxLen(128).
			Unique().
			Comment("元信息键名"),
		field.String("value").
			Optional().
			SchemaType(map[string]string{
				dialect.Postgres: "text",
			}).
			Comment("元信息值"),
	}
}

func (SystemMeta) Edges() []ent.Edge {
	return nil
}
