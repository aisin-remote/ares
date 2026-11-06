Imports SAP.Middleware.Connector
Imports System.Data
Imports System.Data.SqlClient
Imports System.Globalization 

Public Class Form1
    Private _ccc As RfcDestination

    Dim log As String
    Dim con As New SqlConnection
    Dim cmd As New SqlCommand
    Dim cnt As New SqlCommand
    Dim reader As SqlDataReader
    Dim itab As New SqlDataAdapter
    Dim iset As New DataSet
    Dim idt As New DataTable
    Dim numrows As Integer

    Dim WMATERIAL As New DataTable

    Dim sqlquery As String
    Dim count As String

    Dim I_PSTNG_DATE As String
    Dim I_HEADER_TXT As String
    Dim MATERIAL As String
    Dim PLANT As String
    Dim STGE_LOC As String
    Dim SLOC_TO As String
    Dim MOVE_TYPE As String
    Dim ENTRY_QNT As Integer
    Dim NUMBER As Integer
    Dim VENDOR As String
    Dim TYPETRANS As String
    Dim REMARKS As String
    Dim REF_DOC_NO As String

    Dim DEL_NO As String
    Dim DEL_ITEM As String
    Dim STAT As String
    Dim STATUS_PICK As String
    Dim ITEM_NUMBER As Integer

    Dim E_MATERIALDOCUMENT As String
    Dim E_MATDOCUMENTYEAR As String
    Dim timerErr As Integer = 0
    Dim dateErr As String
    Dim timeErr As String

    Private Sub Form1_Load(sender As Object, e As EventArgs) Handles MyBase.Load
        On Error GoTo ErrorHandler
        Me.Hide()
        Me.Visible = False
[connection string omitted]
        con.Open()
        cmd.Connection = con

        RfcDestinationManager.RegisterDestinationConfiguration(New ECCDestinationConfig)
        _ccc = RfcDestinationManager.GetDestination("PRD")
        Dim repository As RfcRepository = _ccc.Repository

        Dim strm As IRfcFunction = _ccc.Repository.CreateFunction("ZZBAPI_GOODSMVT_CREATE")
        Dim strm_pp As IRfcFunction = _ccc.Repository.CreateFunction("ZZBAPI_AIIECC_PP00010")
        Dim strm_sd As IRfcFunction = _ccc.Repository.CreateFunction("ZZBAPI_AIIECC_SD00001")
        Dim strm_no As IRfcFunction = _ccc.Repository.CreateFunction("ZZBAPI_AIIECC_SD00004")
        Dim tab1 As IRfcTable = strm.GetTable("ZTAB")
        Dim tab1_pp As IRfcTable = strm_pp.GetTable("T_GOODSMVT")
        Dim tab1_sd As IRfcTable = strm_sd.GetTable("T_GOODSMVT")
        Dim tab1_no As IRfcTable = strm_no.GetTable("T_GOODSMVT")
        Dim err_msg As String

        sqlquery = "SELECT "
        sqlquery = sqlquery & "* "
        sqlquery = sqlquery & "FROM "
        sqlquery = sqlquery & "TT_GOODS_MOVEMENT_H "
        sqlquery = sqlquery & "INNER JOIN "
        sqlquery = sqlquery & "TT_GOODS_MOVEMENT_L "
        sqlquery = sqlquery & "ON "
        sqlquery = sqlquery & "TT_GOODS_MOVEMENT_H.INT_NUMBER = TT_GOODS_MOVEMENT_L.INT_NUMBER "
        sqlquery = sqlquery & "WHERE "
        sqlquery = sqlquery & "TT_GOODS_MOVEMENT_H.CHR_VALIDATE = 'X' AND TT_GOODS_MOVEMENT_L.CHR_UPLOAD = '0'  AND "
        sqlquery = sqlquery & "(TT_GOODS_MOVEMENT_H.CHR_TYPE_TRANS = 'SUBC' OR "
        sqlquery = sqlquery & "TT_GOODS_MOVEMENT_H.CHR_TYPE_TRANS = 'RTRN' OR  "
        sqlquery = sqlquery & "TT_GOODS_MOVEMENT_H.CHR_TYPE_TRANS = 'STLT' OR "
        sqlquery = sqlquery & "TT_GOODS_MOVEMENT_H.CHR_TYPE_TRANS = 'VCLM' OR "
        sqlquery = sqlquery & "TT_GOODS_MOVEMENT_H.CHR_TYPE_TRANS = 'CKIP'  ) "
        sqlquery = sqlquery & "ORDER BY TT_GOODS_MOVEMENT_H.INT_NUMBER ASC "

        count = "SELECT "
        count = count & "COUNT(*) "
        count = count & "FROM "
        count = count & "TT_GOODS_MOVEMENT_H "
        count = count & "INNER JOIN "
        count = count & "TT_GOODS_MOVEMENT_L "
        count = count & "ON "
        count = count & "TT_GOODS_MOVEMENT_H.INT_NUMBER = TT_GOODS_MOVEMENT_L.INT_NUMBER "
        count = count & "WHERE "
        count = count & "TT_GOODS_MOVEMENT_H.CHR_VALIDATE = 'X' AND TT_GOODS_MOVEMENT_L.CHR_UPLOAD = '0'  AND "
        count = count & "(TT_GOODS_MOVEMENT_H.CHR_TYPE_TRANS = 'SUBC' OR "
        count = count & "TT_GOODS_MOVEMENT_H.CHR_TYPE_TRANS = 'RTRN' OR  "
        count = count & "TT_GOODS_MOVEMENT_H.CHR_TYPE_TRANS = 'STLT' OR "
        count = count & "TT_GOODS_MOVEMENT_H.CHR_TYPE_TRANS = 'VCLM' OR "
        count = count & "TT_GOODS_MOVEMENT_H.CHR_TYPE_TRANS = 'CKIP'  ) "

        cmd = New SqlCommand(sqlquery, con)
        cnt = New SqlCommand(count, con)
        numrows = cnt.ExecuteScalar()
        reader = cmd.ExecuteReader
        While reader.Read
            If Not reader.IsDBNull(0) Then
                'Try
                I_PSTNG_DATE = reader("CHR_DATE")
                I_HEADER_TXT = reader("CHR_REMARKS")

                MATERIAL = reader("CHR_PART_NO")
                PLANT = reader("CHR_PLANT")
                STGE_LOC = reader("CHR_SLOC_FROM")
                SLOC_TO = reader("CHR_SLOC_TO")
                MOVE_TYPE = reader("CHR_MVMT_TYPE")
                ENTRY_QNT = reader("INT_TOTAL_QTY")
                NUMBER = reader("INT_NUMBER")
                ITEM_NUMBER = reader("INT_NUMBER_ITEM")
                TYPETRANS = reader("CHR_TYPE_TRANS")
                REMARKS = reader("CHR_REMARKS")
                REF_DOC_NO = reader("CHR_REMARKS")

                If TYPETRANS = "SUBC" Or
                   TYPETRANS = "RTRN" Or
                   TYPETRANS = "STLT" Or
                   TYPETRANS = "VCLM" Or
                   TYPETRANS = "CKIP" Then

                    VENDOR = reader("CHR_VENDOR_NAME")
                    tab1.Insert()
                    tab1.SetValue("ZPSTNG_DATE", I_PSTNG_DATE)
                    tab1.SetValue("ZHEADER_TXT", I_HEADER_TXT)
                    tab1.SetValue("ZMATERIAL", MATERIAL)
                    tab1.SetValue("ZVENDOR", VENDOR)
                    tab1.SetValue("ZPLANT", PLANT)
                    tab1.SetValue("ZSTGE_LOC", STGE_LOC)
                    tab1.SetValue("ZMOVE_STLOC", SLOC_TO)
                    tab1.SetValue("ZMOVE_TYPE", MOVE_TYPE)
                    tab1.SetValue("ZENTRY_QNT", ENTRY_QNT)
                    tab1.SetValue("ZLONGNUM", NUMBER)
                    tab1.SetValue("ZNUMROWS", numrows)
                    tab1.SetValue("ZCODE", "04")
                    tab1.SetValue("ZTYPETRANS", TYPETRANS)
                    tab1.SetValue("ZREMARKS", REMARKS)
                    tab1.SetValue("ZREF_DOC_NO", REF_DOC_NO)
                    strm.Invoke(_ccc)

                ElseIf TYPETRANS = "FGDL" Or
                       TYPETRANS = "DLFG" Then

                    DEL_NO = reader("CHR_DEL_NO")
                    DEL_ITEM = reader("CHR_DEL_ITEM")
                    strm_sd.SetValue("I_PSTNG_DATE", I_PSTNG_DATE)
                    strm_sd.SetValue("I_HEADER_TXT", I_HEADER_TXT)
                    STAT = reader("CHR_STATUS")
                    STATUS_PICK = reader("CHR_PICK_STATUS")
                    tab1_sd.Insert()
                    tab1_sd.SetValue("ITEM_TEXT", ITEM_NUMBER)
                    tab1_sd.SetValue("MATERIAL", MATERIAL)
                    tab1_sd.SetValue("PLANT", PLANT)
                    tab1_sd.SetValue("STGE_LOC", STGE_LOC)
                    tab1_sd.SetValue("MOVE_STLOC", SLOC_TO)
                    tab1_sd.SetValue("MOVE_TYPE", MOVE_TYPE)
                    tab1_sd.SetValue("ENTRY_QNT", ENTRY_QNT)
                    tab1_sd.SetValue("LONGNUM", NUMBER)
                    tab1_sd.SetValue("DEL_NO", DEL_NO)
                    tab1_sd.SetValue("DEL_ITEM", DEL_ITEM)
                    tab1_sd.SetValue("TRANS_TYPE", TYPETRANS)
                    tab1_sd.SetValue("STAT", STAT)
                    tab1_sd.SetValue("STAT_PICK", STATUS_PICK)
                    strm_sd.Invoke(_ccc)
                    Dim T_RETURN As IRfcTable = strm_sd.GetTable("T_RETURN")

                ElseIf TYPETRANS = "NOFG" Or
                       TYPETRANS = "NODL" Then

                    DEL_NO = reader("CHR_DEL_NO")
                    DEL_ITEM = reader("CHR_DEL_ITEM")
                    STAT = reader("CHR_STATUS")
                    STATUS_PICK = reader("CHR_PICK_STATUS")
                    strm_no.SetValue("I_PSTNG_DATE", I_PSTNG_DATE)
                    strm_no.SetValue("I_HEADER_TXT", I_HEADER_TXT)

                    tab1_no.Insert()
                    tab1_no.SetValue("MATERIAL", MATERIAL)
                    tab1_no.SetValue("ITEM_TEXT", ITEM_NUMBER)
                    tab1_no.SetValue("PLANT", PLANT)
                    tab1_no.SetValue("STGE_LOC", STGE_LOC)
                    tab1_no.SetValue("MOVE_STLOC", SLOC_TO)
                    tab1_no.SetValue("MOVE_TYPE", MOVE_TYPE)
                    tab1_no.SetValue("ENTRY_QNT", ENTRY_QNT)
                    tab1_no.SetValue("LONGNUM", NUMBER)
                    tab1_no.SetValue("DEL_NO", DEL_NO)
                    tab1_no.SetValue("DEL_ITEM", DEL_ITEM)
                    tab1_no.SetValue("TRANS_TYPE", TYPETRANS)
                    tab1_no.SetValue("STAT", STAT)
                    tab1_no.SetValue("STAT_PICK", STATUS_PICK)
                    strm_no.Invoke(_ccc)
                    Dim T_RETURN As IRfcTable = strm_no.GetTable("T_RETURN")
                Else

                    VENDOR = reader("CHR_VENDOR_NAME")
                    strm_pp.SetValue("I_PSTNG_DATE", I_PSTNG_DATE)
                    strm_pp.SetValue("I_HEADER_TXT", I_HEADER_TXT)

                    tab1_pp.Insert()
                    tab1_pp.SetValue("VENDOR", VENDOR)
                    tab1_pp.SetValue("ITEM_TEXT", ITEM_NUMBER)
                    tab1_pp.SetValue("MATERIAL", MATERIAL)
                    tab1_pp.SetValue("PLANT", PLANT)
                    tab1_pp.SetValue("STGE_LOC", STGE_LOC)
                    tab1_pp.SetValue("MOVE_STLOC", SLOC_TO)
                    tab1_pp.SetValue("MOVE_TYPE", MOVE_TYPE)
                    tab1_pp.SetValue("ENTRY_QNT", ENTRY_QNT)
                    tab1_pp.SetValue("LONGNUM", NUMBER)
                    strm_pp.Invoke(_ccc)

                    Dim T_RETURN As IRfcTable = strm_pp.GetTable("T_RETURN")

                End If

                Threading.Thread.Sleep(500)
                'Catch ex As Exception
                'MessageBox.Show(ex.Message.ToString())
                'Me.Close()
                'End Try
            End If
        End While
        Me.Close()

        Exit Sub      ' Exit to avoid handler.
ErrorHandler:  ' Error-handling routine. 
        Timer1.Enabled = True
        dateErr = Format(Now, "yyyyMMdd")
        timeErr = Format(Now, "HHmmss")

        err_msg = (Err.Description.ToString().Replace("'", " ")).Substring(0, 300)

        sqlquery = "INSERT INTO TT_ERR_LOG_INTERFACE (CHR_FUNCTION , CHR_ERROR_MESSAGE , CHR_DATE , CHR_TIME) VALUES " & _
                   "('ERR_MM' , '" & err_msg & "' , '" & dateErr & "' , '" & timeErr & "')"
        cmd = New SqlCommand(sqlquery, con)
        cmd.ExecuteNonQuery()

        Me.Close()
        Exit Sub
    End Sub

    Private Sub Timer1_Tick(sender As Object, e As EventArgs) Handles Timer1.Tick
        timerErr = timerErr + 1
        If (timerErr > 10) Then
            Me.Close()
        End If
    End Sub
End Class