package model

import "strings"

// BaseModelName removes the channel identity; channel filters remain independent.
func BaseModelName(value string) string {
	if index := strings.LastIndex(value, "::"); index >= 0 {
		return value[index+2:]
	}
	return value
}
