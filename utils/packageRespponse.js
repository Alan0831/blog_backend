function packageResponse(status, option, res) {
    let json = {};
    switch(status) {
        case 'success':
            json = {
                status: 200,
                data: option.data || {},
                message: option.successMessage || '成功',
            };
            break;
        case 'error':
            json = {
                status: 'error',
                data: option.data || {},
                errorMessage: option.errorMessage,
            };
            break;
        default:
            json = {};
            break;
    }
    res.set("Content-Type", "application/json");
    res.send(JSON.stringify(json));
}

module.exports = {
    packageResponse
}