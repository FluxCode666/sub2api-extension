package update

import (
	"context"
	"time"
)

type Job struct {
	ID        string    `json:"id"`
	Version   string    `json:"version"`
	Phase     string    `json:"phase"`
	Message   string    `json:"message"`
	StartedAt time.Time `json:"startedAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (j *Job) Active() bool {
	return j != nil && j.Phase != "succeeded" && j.Phase != "failed" && j.Phase != "rolled_back" && j.Phase != "rollback_failed"
}

type Status struct {
	Enabled bool   `json:"enabled"`
	Reason  string `json:"reason,omitempty"`
	Job     *Job   `json:"job,omitempty"`
}

type UpdateRequest struct {
	Version string `json:"version"`
}

// Controller is intentionally in-process. It has no socket or container
// dependency; the application owns the update lifecycle and binary swap.
type Controller interface {
	Status(context.Context) Status
	Start(context.Context, string) (*Job, error)
}
