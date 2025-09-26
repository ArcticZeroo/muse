export const ifTruthy = (value: unknown, trueValue: string, falseValue = '') => {
	if (value) {
		return trueValue;
	}
	return falseValue;
}